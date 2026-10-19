import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { Hub } from './realtime.js';
import { AppError } from './util.js';
import { loadSession, type SessionUser, isStaff } from './services/auth.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerOwnerRoutes } from './routes/owner.js';

export const COOKIE_NAME = 'fd_session';

declare module 'fastify' {
  interface FastifyRequest { user: SessionUser | null }
}

export interface AppDeps { config: Config; db: Db; hub: Hub }

export interface BuildOptions { serveClient?: boolean; logger?: boolean }

export async function buildApp(config: Config, db: Db, opts: BuildOptions = {}): Promise<{ app: FastifyInstance; hub: Hub }> {
  const app = Fastify({
    logger: opts.logger === false ? false : {
      level: 'info',
      // 요청 본문·쿠키·쿼리를 로그에 남기지 않는다(채팅 원문·사번·비밀번호 보호)
      serializers: {
        req: (req) => ({ method: req.method, url: req.url?.split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });
  const hub = new Hub(db, config.eventId, config.databaseUrl, COOKIE_NAME);
  await hub.start();
  app.addHook('preClose', async () => { await hub.stop(); });

  await app.register(cookie);
  app.decorateRequest('user', null);

  const isOriginAllowed = (origin: string | undefined, host: string | undefined): boolean => {
    if (!origin) return true; // 같은 오리진 GET/일부 클라이언트는 Origin 생략 — CSRF 토큰으로 별도 방어
    if (config.allowedOrigins.includes(origin)) return true;
    try { return new URL(origin).host === host; } catch { return false; }
  };

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (!req.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!isOriginAllowed(req.headers.origin, req.headers.host)) {
        throw new AppError(403, 'bad_origin', '허용되지 않은 요청입니다. 앱 주소로 다시 접속해 주세요.');
      }
    }
    req.user = await loadSession(db, config.eventId, req.cookies[COOKIE_NAME]);
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.user) {
      if (req.headers['x-csrf-token'] !== req.user.csrfToken) {
        throw new AppError(403, 'csrf', '보안 확인이 만료되었습니다. 화면을 새로고침해 주세요.');
      }
    }
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.status).send({ error: { code: err.code, message: err.message, ...err.extra } });
      return;
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      reply.status(e.statusCode).send({ error: { code: 'bad_request', message: '요청 형식이 올바르지 않습니다. 화면을 새로고침해 주세요.' } });
      return;
    }
    req.log.error({ code: e.code, msg: e.message }, 'unhandled');
    reply.status(500).send({ error: { code: 'server_error', message: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } });
  });

  const deps: AppDeps = { config, db, hub };
  await app.register(async (api) => {
    registerPublicRoutes(api, deps);
    registerChatRoutes(api, deps);
    registerAdminRoutes(api, deps);
    registerOwnerRoutes(api, deps);
  }, { prefix: '/api' });

  app.server.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] !== '/ws') { socket.destroy(); return; }
    void hub.handleUpgrade(req, socket, head, isOriginAllowed).catch(() => socket.destroy());
  });

  if (opts.serveClient !== false) {
    const here = dirname(fileURLToPath(import.meta.url));
    const clientDir = [join(here, '..', 'client'), join(here, '..', 'dist', 'client'), join(here, '..', '..', 'dist', 'client')].find((p) => existsSync(join(p, 'index.html')));
    if (clientDir) {
      await app.register(fastifyStatic, {
        root: clientDir,
        wildcard: false,
        setHeaders(res, path) {
          if (path.endsWith('index.html')) res.header('Cache-Control', 'no-cache');
          else if (path.includes(`${'/'}bundle${'/'}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
          else res.header('Cache-Control', 'public, max-age=3600');
        },
      });
      app.setNotFoundHandler((req, reply) => {
        if (req.method === 'GET' && !req.url.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(req.url.split('?')[0])) {
          reply.header('Cache-Control', 'no-cache');
          return reply.sendFile('index.html');
        }
        reply.status(404).send({ error: { code: 'not_found', message: '찾을 수 없습니다.' } });
      });
    }
  }
  return { app, hub };
}

// ── 공통 가드 ─────────────────────────────────────────
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new AppError(401, 'unauthenticated', '로그인이 필요합니다. 이름과 사번으로 다시 입장해 주세요.');
  return req.user;
}
export function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (!isStaff(u.role)) throw new AppError(403, 'forbidden', '관리자만 사용할 수 있습니다.');
  return u;
}
export function requireOwner(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (u.role !== 'owner') throw new AppError(403, 'forbidden', 'owner만 사용할 수 있습니다.');
  return u;
}

export function sendCsv(reply: FastifyReply, filename: string, csv: string) {
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${filename}"`);
  return reply.send(csv);
}
