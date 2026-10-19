/**
 * 무료 요금제용 실시간 — Firestore 구독(onSnapshot).
 * 읽기 한도를 아끼려고 채팅 구독은 채팅 화면을 보는 동안만, 관리자 구독은 관리자 화면에서만 켠다.
 */
import { collection, doc, limit, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './fb';
import { chatColl, currentMe, setPublicCache, toMessage } from './api';

type Listener = (ev: { type: string; channel?: string; data?: any; channels?: string[] }) => void;
export type ConnState = 'connecting' | 'online' | 'offline';

class FreeRealtime {
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnState) => void>();
  private subs = new Map<string, Unsubscribe>();
  private channels: string[] = [];
  private focus = 'pass';
  state: ConnState = 'offline';

  constructor() {
    window.addEventListener('offline', () => this.setState('offline'));
    window.addEventListener('online', () => { if (this.channels.length) { this.setState('online'); this.emit({ type: 'reconnected' }); } });
    onAuthStateChanged(auth, (u) => { if (!u) this.stop(); });
  }

  start(channels: string[]) { this.setChannels(channels); }
  reconnectNow() { /* SDK가 자동 재연결 */ }
  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onState(fn: (s: ConnState) => void) { this.stateListeners.add(fn); fn(this.state); return () => { this.stateListeners.delete(fn); }; }
  /** 지금 보고 있는 탭(pass·schedule·map·chat·admin) — 필요한 구독만 유지 */
  setFocus(tab: string) { this.focus = tab; this.apply(); }
  stop() { this.subs.forEach((u) => u()); this.subs.clear(); this.channels = []; setPublicCache(null); this.setState('offline'); }
  setChannels(channels: string[]) { this.channels = channels; this.apply(); }

  private async apply() {
    if (!auth.currentUser || !this.channels.length) return;
    let pid: string;
    try { pid = (await currentMe()).pid; } catch { return; }
    const wanted = new Set<string>(['me', 'public']);
    for (const ch of this.channels) {
      if (ch.startsWith('chat:') && this.focus === 'chat') wanted.add(ch);
      if (ch === 'admin' && this.focus === 'admin') wanted.add(ch);
    }
    for (const [k, u] of this.subs) if (!wanted.has(k)) { u(); this.subs.delete(k); }
    for (const ch of wanted) if (!this.subs.has(ch)) this.subs.set(ch, this.subscribe(ch, pid));
    this.setState(navigator.onLine ? 'online' : 'offline');
  }

  private watch(target: unknown, onChange: (snap: any, first: boolean) => void): Unsubscribe {
    let first = true;
    return onSnapshot(target as any, (snap: any) => { onChange(snap, first); first = false; }, (err) => {
      if ((err as { code?: string }).code === 'permission-denied') this.emit({ type: 'revoked', channels: [] });
    });
  }

  private subscribe(ch: string, pid: string): Unsubscribe {
    if (ch === 'me') return this.watch(doc(db, 'participants', pid), (_s, first) => { if (!first) this.emit({ type: 'me_changed' }); });
    if (ch === 'public') {
      return this.watch(doc(db, 'config', 'public'), (snap, first) => {
        setPublicCache(snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : null);
        if (!first) this.emit({ type: 'public_changed', data: { what: 'all' } });
      });
    }
    if (ch === 'admin') {
      const subs = [
        this.watch(collection(db, 'awards'), (_s, f) => { if (!f) this.emit({ type: 'scores_changed' }); }),
        this.watch(collection(db, 'reversals'), (_s, f) => { if (!f) this.emit({ type: 'scores_changed' }); }),
        this.watch(collection(db, 'help'), (_s, f) => { if (!f) this.emit({ type: 'help_changed' }); }),
        this.watch(collection(db, 'reports'), (_s, f) => { if (!f) this.emit({ type: 'reports_changed' }); }),
      ];
      return () => subs.forEach((u) => u());
    }
    const m = /^chat:(all|team:[0-8])$/.exec(ch);
    if (m) {
      const coll = chatColl(m[1]);
      return this.watch(query(collection(db, coll), orderBy('createdAt', 'desc'), limit(20)), (snap, first) => {
        if (first) return;
        for (const c of snap.docChanges()) {
          if (c.type === 'removed' || c.doc.metadata.hasPendingWrites) continue;
          this.emit({ type: c.type === 'added' ? 'chat_message' : 'chat_update', channel: ch, data: toMessage(c.doc, coll) });
        }
      });
    }
    return () => {};
  }

  private setState(s: ConnState) { this.state = s; this.stateListeners.forEach((f) => f(s)); }
  private emit(ev: any) { this.listeners.forEach((f) => f(ev)); }
}

export const realtime = new FreeRealtime();
