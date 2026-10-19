import { useEffect, useState } from 'react';
import { api, ApiError, errMsg } from '../api';

export function Login({ onLoggedIn, notice }: { onLoggedIn: () => Promise<void>; notice: string | null }) {
  const [name, setName] = useState('');
  const [emp, setEmp] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ title: string; date: string; venue: string; demo: boolean } | null>(null);

  useEffect(() => { api('GET', '/api/public/event').then(setInfo).catch(() => {}); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim() || !emp.trim()) { setErr('이름과 사번을 모두 입력해 주세요.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api<{ isNewCheckin: boolean }>('POST', '/api/login', { name, employeeId: emp });
      if (r.isNewCheckin) sessionStorage.setItem('fd-fresh', '1');
      setEmp('');
      await onLoggedIn();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  const date = info?.date ?? '2026-10-21';
  return (
    <div className="login">
      {info?.demo && <div className="demo-ribbon">DEMO · 가상 TEST 명단으로 동작 중</div>}
      <main className="login-main">
        <div className="login-meta">
          <span>{date.replaceAll('-', '.')} (수)</span>
          <span>{info?.venue ?? '이충동 부락산 분수공원 야외공연장'}</span>
        </div>
        <h1>오늘은,<br /><em>같은 팀.</em></h1>
        <p className="sub">{info?.title ?? '2026 하이테크본부 가을운동회'}</p>

        <form onSubmit={submit} noValidate className="stack" autoComplete="off">
          {notice && <div className="note-card" role="status">{notice}</div>}
          <label className="field">
            <span className="label">이름</span>
            <input className="input" name="fd-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
              aria-invalid={!!err} aria-describedby={err ? 'login-err' : undefined} maxLength={64} enterKeyHint="next" />
          </label>
          <label className="field">
            <span className="label">사번</span>
            <input className="input num" name="fd-emp" value={emp} onChange={(e) => setEmp(e.target.value)} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              aria-invalid={!!err} aria-describedby={err ? 'login-err' : 'emp-hint'} maxLength={64} enterKeyHint="go" />
            <span className="hint" id="emp-hint">사번은 앞자리 0까지 그대로 입력해 주세요.</span>
          </label>
          {err && <div className="form-error" id="login-err" role="alert">{err}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy} style={{ minHeight: 56, fontSize: 17 }}>
            {busy ? <><span className="spinner" aria-hidden="true" />확인 중…</> : '입장하기'}
          </button>
          <p className="xs muted" style={{ textAlign: 'center' }}>사전 등록된 명단과 이름·사번이 같아야 입장할 수 있습니다.</p>
        </form>
      </main>
      <FieldArt />
    </div>
  );
}

/** 하단 잔디 운동장 라인 그래픽 */
function FieldArt() {
  return (
    <div className="login-field-art" aria-hidden="true">
      <svg viewBox="0 0 400 120" preserveAspectRatio="xMidYMid slice">
        {Array.from({ length: 10 }, (_, i) => <rect key={i} x={i * 40} y="0" width="20" height="120" fill="#1B5541" />)}
        <g fill="none" stroke="#F6F4EC" strokeOpacity=".55" strokeWidth="2">
          <rect x="16" y="18" width="368" height="140" rx="2" />
          <line x1="200" y1="18" x2="200" y2="158" />
          <circle cx="200" cy="88" r="34" />
          <rect x="16" y="52" width="46" height="72" />
          <rect x="338" y="52" width="46" height="72" />
        </g>
        <circle cx="200" cy="88" r="4" fill="#D6EF78" />
        <circle cx="300" cy="40" r="7" fill="#F07843" />
      </svg>
    </div>
  );
}
