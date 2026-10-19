import { useState } from 'react';
import { bootstrap, errMsg } from './api';
import { teamLabel } from '../src/util';

/** 배포 직후 한 번만(/setup): 행사 기본값과 첫 owner를 만든다. 한 번 끝나면 다시 동작하지 않는다 */
export function Setup() {
  const [f, setF] = useState({ name: '', employeeId: '', teamNumber: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await bootstrap(f);
      setMsg({ ok: true, text: '설정이 끝났습니다. 아래 버튼으로 들어가 관리자 화면 → 명단·권한에서 명단 CSV를 올리세요.' });
    } catch (err) { setMsg({ ok: false, text: errMsg(err) }); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <main className="login-main">
        <div className="login-meta"><span>최초 1회 설정</span></div>
        <h1 style={{ fontSize: 36 }}>행사 앱<br /><em>준비하기</em></h1>
        <p className="sub">총괄(owner)할 한 분의 이름·사번을 <b>명단과 똑같이</b> 입력하세요. 한 번 끝나면 다시 쓸 수 없습니다.</p>
        <form className="stack" onSubmit={(e) => void submit(e)} autoComplete="off" style={{ marginTop: 24 }}>
          <label className="field"><span className="label">owner 이름</span>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span className="label">owner 사번</span>
            <input className="input" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} /></label>
          <label className="field"><span className="label">owner 조</span>
            <select className="select" value={f.teamNumber} onChange={(e) => setF({ ...f, teamNumber: Number(e.target.value) })}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => <option key={t} value={t}>{teamLabel(t)}</option>)}
            </select></label>
          {msg && <div className={msg.ok ? 'form-ok' : 'form-error'} role="status">{msg.text}</div>}
          {!msg?.ok && <button className="btn btn-primary btn-block" disabled={busy || !f.name || !f.employeeId}>{busy ? '설정 중…' : '설정하기'}</button>}
          {msg?.ok && <a className="btn btn-primary btn-block" href="/">앱으로 들어가기</a>}
        </form>
      </main>
    </div>
  );
}
