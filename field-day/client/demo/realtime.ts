/**
 * 데모용 실시간: 같은 브라우저의 다른 탭에 BroadcastChannel로 알린다.
 * 실제 앱의 realtime.ts와 같은 모양의 객체를 내보낸다.
 */
import { load, session } from './store';

type Listener = (ev: { type: string; channel?: string; data?: any; channels?: string[] }) => void;
export type ConnState = 'connecting' | 'online' | 'offline';

const bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fd-demo') : null;

class DemoRealtime {
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnState) => void>();
  private channels: string[] = [];
  state: ConnState = 'offline';

  constructor() {
    bc?.addEventListener('message', (m) => this.deliver(m.data));
    window.addEventListener('offline', () => this.setState('offline'));
    window.addEventListener('online', () => { if (this.channels.length) { this.setState('online'); this.emit({ type: 'reconnected' }); } });
  }

  start(channels: string[]) { this.channels = channels; this.setState(navigator.onLine ? 'online' : 'offline'); }
  setChannels(channels: string[]) { this.channels = channels; }
  stop() { this.channels = []; this.setState('offline'); }
  reconnectNow() { /* 데모: 항상 연결 */ }
  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onState(fn: (s: ConnState) => void) { this.stateListeners.add(fn); fn(this.state); return () => { this.stateListeners.delete(fn); }; }

  /** 데모 백엔드가 호출: 이 탭과 다른 탭 모두에 전달 */
  publish(ev: { channel: string; type: string; data?: unknown; participantId?: string }) {
    bc?.postMessage(ev);
    setTimeout(() => this.deliver(ev), 0);
  }

  private deliver(ev: { channel: string; type: string; data?: unknown; participantId?: string }) {
    if (!this.channels.length) return;
    const me = session.get();
    if (ev.channel === 'me') {
      if (ev.participantId === me) this.emit({ type: 'me_changed' });
      return;
    }
    // 실제 서버처럼 수신 직전에 현재 권한을 다시 확인
    const p = load().participants.find((x) => x.id === me);
    if (!p) return;
    if (ev.channel === 'admin' && p.role === 'participant') return;
    if (ev.channel.startsWith('chat:team:') && ev.channel !== `chat:team:${p.teamNumber}`) return;
    if (!this.channels.includes(ev.channel)) return;
    this.emit({ type: ev.type, channel: ev.channel, data: ev.data });
  }

  private setState(s: ConnState) { this.state = s; this.stateListeners.forEach((f) => f(s)); }
  private emit(ev: any) { this.listeners.forEach((f) => f(ev)); }
}

export const realtime = new DemoRealtime();
