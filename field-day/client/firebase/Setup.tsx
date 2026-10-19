import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { fns } from './fb';

/** 배포 직후 한 번만 쓰는 화면(/setup): 설정 키로 행사 기본값을 만들고 첫 owner를 등록한다 */
export function Setup() {
  const [f, setF] = useState({ setupKey: '', name: '', employeeId: '', teamNumber: 1 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await httpsCallable(fns, 'bootstrap')(f);
      setMsg({ ok: true, text: '설정이 끝났습니다. 이제 첫 화면에서 방금 입력한 이름·사번으로 입장해 관리자 화면 → 명단·권한에서 명단 CSV를 올리세요.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message || '설정하지 못했습니다.' });
    } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <main className="login-main">
        <div className="login-meta"><span>최초 1회 설정</span></div>
        <h1 style={{ fontSize: 36 }}>행사 앱<br /><em>준비하기</em></h1>
        <p className="sub">배포 직후 owner(총괄) 한 명만 사용합니다. 한 번 끝나면 다시 쓸 수 없습니다.</p>
        <form className="stack" onSubmit={(e) => void submit(e)} autoComplete="off" style={{ marginTop: 24 }}>
          <label className="field"><span className="label">설정 키 (Functions 배포 때 입력한 SETUP_KEY)</span>
            <input className="input" type="password" value={f.setupKey} onChange={(e) => setF({ ...f, setupKey: e.target.value })} /></label>
          <label className="field"><span className="label">owner 이름</span>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span className="label">owner 사번</span>
            <input className="input" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} /></label>
          <label className="field"><span className="label">owner 조</span>
            <select className="select" value={f.teamNumber} onChange={(e) => setF({ ...f, teamNumber: Number(e.target.value) })}>
              {Array.from({ length: 8 }, (_, i) => <option key={i} value={i + 1}>{i + 1}조</option>)}
            </select></label>
          {msg && <div className={msg.ok ? 'form-ok' : 'form-error'} role="status">{msg.text}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || !f.setupKey || !f.name || !f.employeeId}>{busy ? '설정 중…' : '설정하기'}</button>
          {msg?.ok && <a className="btn btn-ghost btn-block" href="/">입장 화면으로</a>}
        </form>
      </main>
    </div>
  );
}
