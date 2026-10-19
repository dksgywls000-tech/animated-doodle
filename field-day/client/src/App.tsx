import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError, setCsrf } from './api';
import { realtime } from './realtime';
import { MeCtx, useMe, type Me } from './session';
import { useConn, useHashRoute, useOnline } from './hooks';
import { ToastProvider } from './components/Toast';
import { Login } from './screens/Login';
import { Pass } from './screens/Pass';
import { Schedule } from './screens/Schedule';
import { Maps } from './screens/Maps';
import { Chat } from './screens/Chat';
import { IconChat, IconMap, IconPass, IconSchedule, IconShield, IconWifiOff } from './components/Icons';

const AdminApp = lazy(() => import('./admin/AdminApp'));

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('GET', '/api/me');
      setCsrf(m.csrfToken);
      setMe(m);
      setBoot('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setMe(null); setBoot('ready'); }
      else setBoot((b) => (b === 'loading' ? 'error' : b));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onUnauth = () => {
      setMe((m) => { if (m) setNotice('로그인이 만료되었습니다. 이름과 사번으로 다시 입장해 주세요.'); return null; });
      realtime.stop();
    };
    window.addEventListener('fd:unauthenticated', onUnauth);
    return () => window.removeEventListener('fd:unauthenticated', onUnauth);
  }, []);

  // 실시간 구독 — 서버가 다시 검증한다
  useEffect(() => {
    if (!me) { realtime.stop(); return; }
    const channels = ['public', 'chat:all', `chat:team:${me.teamNumber}`, ...(me.isStaff ? ['admin'] : [])];
    realtime.start(channels);
    const off = realtime.on((ev) => {
      if (ev.type === 'me_changed' || ev.type === 'revoked') void refresh();
      if (ev.type === 'session_ended') { setMe(null); setNotice('다른 곳에서 로그아웃되었거나 권한이 변경되었습니다. 다시 입장해 주세요.'); realtime.stop(); }
    });
    return off;
  }, [me?.id, me?.teamNumber, me?.isStaff, refresh]);

  const logout = useCallback(async () => {
    try { await api('POST', '/api/logout'); } catch { /* 이미 만료 */ }
    realtime.stop();
    setMe(null);
    // 메모리에 남은 개인·관리자 데이터를 확실히 지우기 위해 새로 불러온다
    location.replace(location.pathname);
  }, []);

  if (boot === 'loading') return <div className="login" aria-busy="true"><div className="login-main"><div className="skeleton" style={{ height: 22, width: '60%' }} /><div className="skeleton" style={{ height: 120, marginTop: 28 }} /></div></div>;
  if (boot === 'error') {
    return (
      <div className="state-box" style={{ paddingTop: 120 }}>
        <div className="ic"><IconWifiOff /></div>
        <h3>서버에 연결하지 못했습니다</h3>
        <p>네트워크 연결을 확인한 뒤 다시 시도해 주세요.</p>
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => { setBoot('loading'); void refresh(); }}>다시 시도</button>
      </div>
    );
  }
  return (
    <ToastProvider>
      {me ? (
        <MeCtx.Provider value={{ me, refresh, logout }}>
          <Shell />
        </MeCtx.Provider>
      ) : (
        <Login notice={notice} onLoggedIn={async () => { setNotice(null); await refresh(); location.hash = '/pass'; }} />
      )}
    </ToastProvider>
  );
}

function Shell() {
  const [route, go] = useHashRoute();
  const online = useOnline();
  const conn = useConn();
  const [unread, setUnread] = useState({ all: 0, team: 0 });
  const [fresh, setFresh] = useState(false);
  const { me } = useMe();
  const tab = route.split('/')[1] || 'pass';

  const loadUnread = useCallback(async () => {
    try { setUnread(await api('GET', '/api/chat/unread')); } catch { /* 무시 */ }
  }, []);
  useEffect(() => { void loadUnread(); }, [loadUnread, tab]);
  useEffect(() => realtime.on((ev) => {
    if (ev.type === 'chat_message' && ev.data?.senderId !== me.id && tab !== 'chat') {
      setUnread((u) => (ev.channel === 'chat:all' ? { ...u, all: u.all + 1 } : { ...u, team: u.team + 1 }));
    }
    if (ev.type === 'reconnected') void loadUnread();
  }), [me.id, tab, loadUnread]);

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  useEffect(() => {
    if (sessionStorage.getItem('fd-fresh') === '1') { sessionStorage.removeItem('fd-fresh'); setFresh(true); }
  }, []);

  if (tab === 'admin') {
    if (!me.isStaff) {
      return (
        <div className="state-box" style={{ paddingTop: 120 }}>
          <div className="ic"><IconShield /></div>
          <h3>관리자만 볼 수 있는 화면입니다</h3>
          <p>참가자 화면으로 돌아가 주세요.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => go('/pass')}>참가자 화면으로</button>
        </div>
      );
    }
    return <Suspense fallback={<div className="state-box">관리자 화면을 불러오는 중…</div>}><AdminApp route={route} go={go} /></Suspense>;
  }

  const totalUnread = unread.all + unread.team;
  const offline = !online || conn === 'offline';
  return (
    <div className="app">
      {offline && tab !== 'chat' && (
        <div className="conn-banner" role="status">
          {online ? '실시간 연결이 끊겼습니다. 다시 연결하는 중…' : '오프라인입니다. 연결되면 자동으로 다시 불러옵니다.'}
        </div>
      )}
      {me.demo && tab !== 'chat' && <div className="demo-ribbon">DEMO · 가상 TEST 데이터</div>}
      {tab === 'pass' && <Pass go={go} fresh={fresh} />}
      {tab === 'schedule' && <Schedule />}
      {tab === 'map' && <Maps route={route} go={go} />}
      {tab === 'chat' && <Chat unread={unread} onRead={(ch) => setUnread((u) => ({ ...u, [ch]: 0 }))} />}

      {me.isStaff && tab !== 'chat' && (
        <div className="admin-cta-wrap">
          <div className="admin-cta-inner">
            <button className="btn admin-cta" onClick={() => go('/admin')}><IconShield size={20} />관리자 화면</button>
          </div>
        </div>
      )}
      <nav className="tabbar" aria-label="주요 메뉴">
        <div className="tabbar-inner">
          <TabBtn id="pass" cur={tab} go={go} label="내 패스" icon={<IconPass />} />
          <TabBtn id="schedule" cur={tab} go={go} label="일정" icon={<IconSchedule />} />
          <TabBtn id="map" cur={tab} go={go} label="안내 지도" icon={<IconMap />} />
          <TabBtn id="chat" cur={tab} go={go} label="채팅" icon={<IconChat />} badge={totalUnread} />
        </div>
      </nav>
    </div>
  );
}

function TabBtn({ id, cur, go, label, icon, badge }: { id: string; cur: string; go: (r: string) => void; label: string; icon: React.ReactNode; badge?: number }) {
  return (
    <button className="tab" aria-current={cur === id ? 'page' : undefined} onClick={() => go('/' + id)}>
      {icon}
      <span>{label}</span>
      {!!badge && <span className="count num" aria-label={`읽지 않은 메시지 ${badge}개`}>{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}
