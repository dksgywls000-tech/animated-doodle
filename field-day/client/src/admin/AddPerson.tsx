import { useState } from 'react';
import { api, errMsg } from '../api';
import { useMe } from '../session';
import { teamLabel } from '../util';

const TEAMS = [1, 2, 3, 4, 5, 6, 7, 8, 0];

/** 명단에 없는 사람을 현장에서 한 명씩 추가 — 추가 즉시 이름+사번으로 입장 가능 */
export function AddPerson({ onAdded }: { onAdded: () => void }) {
  const { me } = useMe();
  const [f, setF] = useState({ name: '', employeeId: '', teamNumber: 1, role: 'participant' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await api('POST', '/api/admin/participants', f);
      setMsg({ ok: true, text: `${f.name}(${teamLabel(f.teamNumber)})님을 추가했습니다. 이제 이름·사번으로 입장할 수 있습니다.` });
      setF({ ...f, name: '', employeeId: '' });
      onAdded();
    } catch (err) { setMsg({ ok: false, text: errMsg(err) }); } finally { setBusy(false); }
  };
  return (
    <form className="panel" onSubmit={(e) => void submit(e)} autoComplete="off">
      <h2 className="h-sec">인원 추가</h2>
      <p className="xs muted">명단에 없는 사람을 한 명씩 추가합니다. 사번은 앞자리 0까지 그대로 입력하세요.</p>
      <div className="filters" style={{ marginTop: 10 }}>
        <label className="field"><span className="label">이름</span><input className="input" style={{ minHeight: 44 }} value={f.name} maxLength={64} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span className="label">사번</span><input className="input num" style={{ minHeight: 44 }} value={f.employeeId} maxLength={64} onChange={(e) => setF({ ...f, employeeId: e.target.value })} /></label>
        <label className="field"><span className="label">조</span>
          <select className="select" aria-label="추가할 사람의 조" value={f.teamNumber} onChange={(e) => setF({ ...f, teamNumber: Number(e.target.value) })}>
            {TEAMS.map((t) => <option key={t} value={t}>{teamLabel(t)}</option>)}
          </select></label>
        <label className="field"><span className="label">역할</span>
          <select className="select" aria-label="추가할 사람의 역할" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} disabled={me.role !== 'owner'}>
            <option value="participant">참가자</option>
            {me.role === 'owner' && <option value="admin">관리자</option>}
          </select></label>
      </div>
      {msg && <div className={msg.ok ? 'form-ok' : 'form-error'} role="status" style={{ marginTop: 10 }}>{msg.text}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || !f.name.trim() || !f.employeeId.trim()}>{busy ? '추가 중…' : '명단에 추가'}</button>
    </form>
  );
}
