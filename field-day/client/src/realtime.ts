type Listener = (ev: { type: string; channel?: string; data?: any; channels?: string[] }) => void;
export type ConnState = 'connecting' | 'online' | 'offline';

/** WebSocket 연결 — 자동 재연결, 구독 복원. 쓰기 작업은 절대 큐에 쌓지 않는다. */
class Realtime {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnState) => void>();
  private channels: string[] = [];
  private retry = 0;
  private timer: number | null = null;
  private stopped = true;
  state: ConnState = 'offline';

  start(channels: string[]) {
    this.channels = channels;
    this.stopped = false;
    if (this.ws && this.ws.readyState <= 1) { this.subscribe(); return; }
    this.connect();
  }

  setChannels(channels: string[]) {
    this.channels = channels;
    this.subscribe();
  }

  stop() {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.setState('offline');
  }

  setFocus(_tab: string) { /* 이 구현은 탭과 무관하게 구독 */ }
  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onState(fn: (s: ConnState) => void) { this.stateListeners.add(fn); fn(this.state); return () => { this.stateListeners.delete(fn); }; }

  private setState(s: ConnState) { this.state = s; this.stateListeners.forEach((f) => f(s)); }

  private connect() {
    if (this.stopped) return;
    this.setState('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.setState('online'); this.subscribe(); this.emit({ type: 'reconnected' }); };
    ws.onmessage = (m) => { try { this.emit(JSON.parse(m.data)); } catch { /* ignore */ } };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setState('offline');
      if (this.stopped) return;
      const delay = Math.min(15000, 800 * 2 ** this.retry++) + Math.random() * 500;
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private subscribe() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'subscribe', channels: this.channels }));
  }

  private emit(ev: any) { this.listeners.forEach((f) => f(ev)); }

  reconnectNow() { if (!this.ws && !this.stopped) { if (this.timer) clearTimeout(this.timer); this.retry = 0; this.connect(); } }
}

export const realtime = new Realtime();
window.addEventListener('online', () => realtime.reconnectNow());
