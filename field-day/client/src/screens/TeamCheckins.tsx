import { useState } from 'react';
import { useApi } from '../hooks';
import { fmtTime, teamLabel } from '../util';
import { Sheet } from '../components/Sheet';

interface Data { teamNumber: number; total: number; checkedIn: number; people: { id: string; name: string; checkedInAt: string | null }[]; generatedAt: string }

/** 조장 전용: 우리 조 체크인 현황 */
export function TeamCheckins() {
  const { data, error, loading, reload } = useApi<Data>('/api/team/checkins');
  const [open, setOpen] = useState(false);
  if (error || !data) return null;
  const missing = data.people.filter((p) => !p.checkedInAt);
  const pct = data.total ? (data.checkedIn / data.total) * 100 : 0;
  return (
    <section className="leader-card" aria-label="우리 조 체크인 현황" style={{ marginTop: 16 }}>
      <div className="between">
        <div>
          <div className="leader-kicker">조장 전용 · {teamLabel(data.teamNumber)} 체크인</div>
          <div className="leader-count num"><b>{data.checkedIn}</b><span>/{data.total}명 입장</span></div>
        </div>
        <button className="btn btn-ghost btn-s" onClick={() => void reload()} disabled={loading}>{loading ? '…' : '새로고침'}</button>
      </div>
      <div className="meter" style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div>
      <p className="xs muted" style={{ marginTop: 6 }}>
        {missing.length ? <>미입장 {missing.length}명: {missing.slice(0, 6).map((p) => p.name).join(', ')}{missing.length > 6 ? ' 외' : ''}</> : '모두 입장했어요!'} · {fmtTime(data.generatedAt)} 기준
      </p>
      <button className="btn btn-plain small" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setOpen(true)}>조원 전체 보기</button>
      {open && (
        <Sheet title={`${teamLabel(data.teamNumber)} 체크인 ${data.checkedIn}/${data.total}`} onClose={() => setOpen(false)}>
          {data.people.map((p) => (
            <div className="list-row" key={p.id}>
              <span style={{ fontWeight: 700 }}>{p.name}</span>
              {p.checkedInAt ? <span className="badge lime">{fmtTime(p.checkedInAt)} 입장</span> : <span className="badge orange">미입장</span>}
            </div>
          ))}
        </Sheet>
      )}
    </section>
  );
}
