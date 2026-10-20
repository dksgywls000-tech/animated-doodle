import { useState } from 'react';
import { api, errMsg } from '../api';
import { useApi } from '../hooks';
import { useToast } from '../components/Toast';
import { teamLabel } from '../util';

interface Leader { pid: string; name: string; teamNumber: number }

/** 조장 지정 — 지정된 사람은 내 패스 화면에서 자기 조원의 체크인 현황을 본다 */
export function Leaders() {
  const toast = useToast();
  const { data, reload } = useApi<{ people: Leader[] }>('/api/admin/leaders');
  const [names, setNames] = useState('');
  const [msg, setMsg] = useState<{ added: string[]; problems: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr(null);
    try { await fn(); toast(done); await reload(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const add = () => run(async () => { const r = await api<{ added: string[]; problems: string[] }>('POST', '/api/admin/leaders', { names }); setMsg(r); if (!r.problems.length) setNames(''); }, '조장 지정을 저장했습니다');
  const del = (x: Leader) => run(() => api('DELETE', `/api/admin/leaders/${x.pid}`), `${x.name}님 조장 지정을 해제했습니다`);

  return (
    <section className="panel" aria-label="조장 지정">
      <div className="between" style={{ marginBottom: 6 }}>
        <h2 className="h-sec">조장 {data?.people.length ?? 0}명</h2>
      </div>
      <p className="xs muted" style={{ marginBottom: 8 }}>지정된 조장은 내 패스 화면에서 <b>자기 조원</b>의 입장 여부만 볼 수 있습니다(행운권 번호·사번·다른 조는 볼 수 없음).</p>
      {!!data?.people.length && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {data.people.map((x) => (
            <button key={x.pid} className="chip" disabled={busy} onClick={() => void del(x)} aria-label={`${x.name} 조장 해제`}>{x.name} · {teamLabel(x.teamNumber)} ✕</button>
          ))}
        </div>
      )}
      <label className="field">
        <span className="label">조장 이름 (줄바꿈·쉼표로 여러 명, 동명이인은 '홍길동 3조')</span>
        <textarea className="input" rows={3} value={names} onChange={(e) => setNames(e.target.value)} aria-label="조장 이름" placeholder={'예: 홍길동 1조\n김철수 2조'} />
      </label>
      <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy || !names.trim()} onClick={() => void add()}>조장으로 지정</button>
      {msg && (
        <div className="xs" style={{ marginTop: 8 }} role="status">
          {msg.added.length > 0 && <div>지정: {msg.added.join(', ')}</div>}
          {msg.problems.map((p) => <div key={p} style={{ color: 'var(--orange-text)' }}>{p}</div>)}
        </div>
      )}
      {err && <div className="form-error" role="alert" style={{ marginTop: 10 }}>{err}</div>}
    </section>
  );
}
