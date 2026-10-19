/**
 * Firebase 실시간 어댑터 — 실제 앱의 realtime.ts와 같은 모양.
 * Firestore 실시간 구독(onSnapshot)을 걸고, 바뀌면 화면이 이미 알고 있는 이벤트(chat_message, scores_changed…)로 알려 준다.
 * 어떤 구독이 허용되는지는 firestore.rules가 결정한다(점수 구독은 관리자만 성공).
 */
import { collection, doc, limit, onSnapshot, orderBy, query, where, type Unsubscribe } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './fb';
import { toMessage } from './api';

type Listener = (ev: { type: string; channel?: string; data?: any; channels?: string[] }) => void;
export type ConnState = 'connecting' | 'online' | 'offline';

class FirebaseRealtime {
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnState) => void>();
  private subs = new Map<string, Unsubscribe>();
  private channels: string[] = [];
  state: ConnState = 'offline';

  constructor() {
    window.addEventListener('offline', () => this.setState('offline'));
    window.addEventListener('online', () => { if (this.channels.length) { this.setState('online'); this.emit({ type: 'reconnected' }); } });
    onAuthStateChanged(auth, (u) => { if (!u) this.stop(); });
  }

  start(channels: string[]) { this.setChannels(channels); }
  reconnectNow() { /* Firestore SDK가 자동 재연결 */ }
  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onState(fn: (s: ConnState) => void) { this.stateListeners.add(fn); fn(this.state); return () => { this.stateListeners.delete(fn); }; }

  stop() {
    this.subs.forEach((u) => u());
    this.subs.clear();
    this.channels = [];
    this.setState('offline');
  }

  setChannels(channels: string[]) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    this.channels = channels;
    const wanted = new Set([...channels, 'me']);
    for (const [k, u] of this.subs) if (!wanted.has(k)) { u(); this.subs.delete(k); }
    for (const ch of wanted) if (!this.subs.has(ch)) this.subs.set(ch, this.subscribe(ch, uid));
    this.setState(navigator.onLine ? 'online' : 'offline');
  }

  /** 첫 스냅샷(현재 상태)은 건너뛰고 이후 변경만 이벤트로 */
  private watch(q: unknown, onChange: (snap: any) => void): Unsubscribe {
    let first = true;
    return onSnapshot(q as any, (snap: any) => { if (first) { first = false; return; } onChange(snap); }, (err) => {
      if ((err as { code?: string }).code === 'permission-denied') this.emit({ type: 'revoked', channels: [] });
    });
  }

  private subscribe(ch: string, uid: string): Unsubscribe {
    if (ch === 'me') return this.watch(doc(db, 'participants', uid), () => this.emit({ type: 'me_changed' }));
    if (ch === 'public') {
      const subs = [
        this.watch(doc(db, 'config', 'event'), () => this.emit({ type: 'public_changed', data: { what: 'event' } })),
        this.watch(query(collection(db, 'schedule'), where('public', '==', true)), () => this.emit({ type: 'public_changed', data: { what: 'schedule' } })),
        this.watch(query(collection(db, 'announcements'), where('published', '==', true)), () => this.emit({ type: 'public_changed', data: { what: 'announcements' } })),
      ];
      return () => subs.forEach((u) => u());
    }
    if (ch === 'admin') {
      const subs = [
        this.watch(collection(db, 'awards'), () => this.emit({ type: 'scores_changed' })),
        this.watch(collection(db, 'reversals'), () => this.emit({ type: 'scores_changed' })),
        this.watch(collection(db, 'help'), () => this.emit({ type: 'help_changed' })),
        this.watch(collection(db, 'reports'), () => this.emit({ type: 'reports_changed' })),
      ];
      return () => subs.forEach((u) => u());
    }
    const m = /^chat:(all|team:[1-8])$/.exec(ch);
    if (m) {
      return this.watch(query(collection(db, 'messages'), where('channel', '==', m[1]), orderBy('createdAt', 'desc'), limit(30)), (snap) => {
        for (const c of snap.docChanges()) {
          if (c.type === 'removed') continue;
          // 내가 보낸 메시지의 로컬 대기 상태는 무시(서버 확정 후 다시 옴)
          if (c.doc.metadata.hasPendingWrites) continue;
          this.emit({ type: c.type === 'added' ? 'chat_message' : 'chat_update', channel: ch, data: toMessage(c.doc) });
        }
      });
    }
    return () => {};
  }

  private setState(s: ConnState) { this.state = s; this.stateListeners.forEach((f) => f(s)); }
  private emit(ev: any) { this.listeners.forEach((f) => f(ev)); }
}

export const realtime = new FirebaseRealtime();
