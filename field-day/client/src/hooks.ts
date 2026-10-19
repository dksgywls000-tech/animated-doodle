import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { realtime, type ConnState } from './realtime';

export function useHashRoute(): [string, (r: string) => void] {
  const get = () => (location.hash.replace(/^#/, '') || '/pass');
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: string) => { if (get() !== r) location.hash = r; }, []);
  return [route, go];
}

/** GET 요청 + 실시간 이벤트로 재조회 */
export function useApi<T>(url: string | null, refetchOn: (ev: { type: string; data?: any }) => boolean = () => false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);
  const pred = useRef(refetchOn);
  pred.current = refetchOn;
  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>('GET', url);
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e as ApiError);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => realtime.on((ev) => { if (ev.type === 'reconnected' || pred.current(ev)) void load(); }), [load]);
  return { data, error, loading, reload: load, setData };
}

export function useConn(): ConnState {
  const [s, setS] = useState<ConnState>(realtime.state);
  useEffect(() => realtime.onState(setS), []);
  return s;
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true); const b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}
