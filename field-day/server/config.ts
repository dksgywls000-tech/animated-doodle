import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export type AppMode = 'demo' | 'production';

export interface Config {
  databaseUrl: string;
  mode: AppMode;
  port: number;
  host: string;
  eventId: string;
  /** 쿠키 Secure 여부. 운영(HTTPS)에서는 반드시 true */
  secureCookies: boolean;
  /** 허용 Origin 목록(CSRF 보조 검증). 비우면 Host 헤더와 같은 Origin만 허용 */
  allowedOrigins: string[];
  /** 로그인 시도 키 HMAC용 비밀값 */
  rateLimitSecret: string;
  /** scrypt$N$salt$hash 형식. 미설정 시 기본 비밀번호 1234의 해시를 기동 시 생성 */
  cancelPasswordHash: string;
  cancelPasswordIsDefault: boolean;
  sessionTtlHours: number;
  trustProxy: boolean;
  bootstrapOwnerIds: string[];
}

export class ConfigError extends Error {}

export function hashPassword(password: string, salt = randomBytes(16)): string {
  const N = 16384;
  const hash = scryptSync(password, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = scryptSync(password, salt, expected.length, { N, r: 8, p: 1 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) missing.push('DATABASE_URL — PostgreSQL 접속 문자열 (예: postgres://user:pass@localhost:5432/fieldday)');
  const mode = (env.APP_MODE ?? '') as AppMode;
  if (mode !== 'demo' && mode !== 'production') missing.push('APP_MODE — "production"(실제 운영) 또는 "demo"(가상 TEST 명단)');
  const rateLimitSecret = env.RATE_LIMIT_SECRET ?? '';
  if (mode === 'production' && rateLimitSecret.length < 16) missing.push('RATE_LIMIT_SECRET — 16자 이상 임의 문자열');
  if (missing.length) {
    throw new ConfigError('필수 환경변수가 없습니다:\n  - ' + missing.join('\n  - ') + '\n.env.example을 참고해 설정하세요.');
  }
  let cancelPasswordHash = env.SCORE_CANCEL_PASSWORD_HASH ?? '';
  let cancelPasswordIsDefault = false;
  if (!cancelPasswordHash) {
    cancelPasswordHash = hashPassword('1234');
    cancelPasswordIsDefault = true;
  } else if (!cancelPasswordHash.startsWith('scrypt$')) {
    throw new ConfigError('SCORE_CANCEL_PASSWORD_HASH 형식이 잘못되었습니다. `npm run hash-password`로 생성하세요.');
  }
  const secureCookies = env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : mode === 'production';
  return {
    databaseUrl,
    mode,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    eventId: env.EVENT_ID ?? 'autumn-2026',
    secureCookies,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    rateLimitSecret: rateLimitSecret || 'demo-only-rate-limit-secret',
    cancelPasswordHash,
    cancelPasswordIsDefault,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 36),
    trustProxy: env.TRUST_PROXY === 'true',
    bootstrapOwnerIds: (env.BOOTSTRAP_OWNER_EMPLOYEE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
