import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import pg from 'pg';
import type { Db } from './db.js';
import { sha256 } from './util.js';

/**
 * 실시간 전송.
 * - 업그레이드 시 쿠키 세션 검증
 * - 구독 요청마다 권한 검증 (team 채널은 본인 조, admin 채널은 admin/owner)
 * - 전송 직전에 DB에서 수신자 권한을 다시 확인 → 권한을 잃은 세션에는 데이터가 가지 않음
 * - 여러 서버 인스턴스는 Postgres LISTEN/NOTIFY로 이벤트를 공유
 */

type Channel = string; // 'public' | 'chat:all' | 'chat:team:N' | 'admin' | 'me'

interface Conn {
  ws: WebSocket;
  sessionHash: string;
  participantId: string;
  subs: Set<Channel>;
  alive: boolean;
}

interface Auth { role: string; team: number; participantId: string }

export interface HubEvent {
  channel: Channel;
  /** channel === 'me' 일 때 대상 참가자 */
  participantId?: string;
  type: string;
  data?: unknown;
}

const NOTIFY_CHANNEL = 'fd_events';

export class Hub {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private conns = new Set<Conn>();
  private listener: pg.Client | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private db: Db, private eventId: string, private databaseUrl: string, private cookieName: string) {}

  async start(): Promise<void> {
    this.listener = new pg.Client({ connectionString: this.databaseUrl });
    await this.listener.connect();
    this.listener.on('notification', (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
      try {
        void this.deliver(JSON.parse(msg.payload) as HubEvent);
      } catch { /* ignore */ }
    });
    this.listener.on('error', (err) => console.error('[hub] listener error', err.message));
    await this.listener.query(`LISTEN ${NOTIFY_CHANNEL}`);
    this.heartbeat = setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) { c.ws.terminate(); this.conns.delete(c); continue; }
        c.alive = false;
        c.ws.ping();
      }
    }, 25_000);
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.conns) c.ws.terminate();
    this.conns.clear();
    await this.listener?.end().catch(() => {});
    this.wss.close();
  }

  /** 다른 인스턴스까지 전파 */
  async publish(ev: HubEvent): Promise<void> {
    await this.db.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(ev)]);
  }

  /** 권한 변경 시 해당 참가자의 구독을 즉시 재검증 */
  async revalidate(participantId: string): Promise<void> {
    await this.publish({ channel: 'me', participantId, type: 'revalidate' });
  }

  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, isOriginAllowed: (o: string | undefined, host: string | undefined) => boolean) {
    if (!isOriginAllowed(req.headers.origin, req.headers.host)) { socket.destroy(); return; }
    const token = parseCookie(req.headers.cookie ?? '')[this.cookieName];
    const sessionHash = token ? sha256(token) : '';
    const auth = sessionHash ? (await this.authorize([sessionHash])).get(sessionHash) : undefined;
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const conn: Conn = { ws, sessionHash, participantId: auth.participantId, subs: new Set(['me']), alive: true };
      this.conns.add(conn);
      ws.on('pong', () => { conn.alive = true; });
      ws.on('close', () => this.conns.delete(conn));
      ws.on('message', (raw) => { void this.onMessage(conn, raw.toString()); });
      send(ws, { type: 'hello' });
    });
  }

  private async onMessage(conn: Conn, raw: string) {
    let msg: { type?: string; channels?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'ping') { send(conn.ws, { type: 'pong' }); return; }
    if (msg.type !== 'subscribe' || !Array.isArray(msg.channels)) return;
    const auth = (await this.authorize([conn.sessionHash])).get(conn.sessionHash);
    if (!auth) { send(conn.ws, { type: 'session_ended' }); conn.ws.close(4001, 'session'); return; }
    const granted: string[] = [];
    const denied: string[] = [];
    conn.subs = new Set(['me']);
    for (const ch of msg.channels.slice(0, 10)) {
      if (typeof ch !== 'string') continue;
      if (canSubscribe(auth, ch)) { conn.subs.add(ch); granted.push(ch); } else denied.push(ch);
    }
    send(conn.ws, { type: 'subscribed', channels: granted, denied });
  }

  /** 세션 해시 → 현재 권한 (DB 기준) */
  private async authorize(hashes: string[]): Promise<Map<string, Auth>> {
    const out = new Map<string, Auth>();
    if (!hashes.length) return out;
    const { rows } = await this.db.query(
      `SELECT s.token_hash, p.id, p.role, p.team_number FROM sessions s JOIN participants p ON p.id=s.participant_id
       WHERE s.token_hash = ANY($1) AND s.revoked_at IS NULL AND s.expires_at > now() AND p.active AND p.event_id=$2`,
      [hashes, this.eventId],
    );
    for (const r of rows) out.set(r.token_hash, { role: r.role, team: r.team_number, participantId: r.id });
    return out;
  }

  private async deliver(ev: HubEvent) {
    const targets = [...this.conns].filter((c) =>
      ev.channel === 'me' ? c.participantId === ev.participantId : c.subs.has(ev.channel));
    if (!targets.length) return;
    let auth: Map<string, Auth>;
    try {
      auth = await this.authorize([...new Set(targets.map((c) => c.sessionHash))]);
    } catch { return; }
    for (const c of targets) {
      const a = auth.get(c.sessionHash);
      if (!a) { send(c.ws, { type: 'session_ended' }); c.ws.close(4001, 'session'); this.conns.delete(c); continue; }
      // 권한이 바뀐 구독은 즉시 제거
      const revoked = [...c.subs].filter((ch) => ch !== 'me' && !canSubscribe(a, ch));
      for (const ch of revoked) c.subs.delete(ch);
      if (revoked.length) send(c.ws, { type: 'revoked', channels: revoked });
      if (ev.type === 'revalidate') { send(c.ws, { type: 'me_changed' }); continue; }
      if (ev.channel !== 'me' && !c.subs.has(ev.channel)) continue;
      send(c.ws, { type: ev.type, channel: ev.channel, data: ev.data });
    }
  }

  connectionCount() { return this.conns.size; }
}

export function canSubscribe(a: Auth, ch: string): boolean {
  if (ch === 'public' || ch === 'chat:all') return true;
  if (ch === 'admin') return a.role === 'admin' || a.role === 'owner';
  const m = /^chat:team:([1-8])$/.exec(ch);
  if (m) return Number(m[1]) === a.team;
  return false;
}

function send(ws: WebSocket, obj: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

export function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
