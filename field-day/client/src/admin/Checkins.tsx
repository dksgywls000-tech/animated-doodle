import { useState } from 'react';
import { useApi } from '../hooks';
import { fmtFull, formatTicket } from '../util';

interface Person { id: string; name: string; employeeId: string; teamNumber: number; role: string; active: boolean; ticketNumber: number | null; checkedInAt: string | null }

export function Checkins() {
  const { data, reload } = useApi<{ teams: { teamNumber: number; total: number; checkedIn: number }[]; total: number; checkedIn: number; people: Person[] }>('/api/admin/checkins');
  const [q, setQ] = useState('');
  const [team, setTeam] = useState(0);
  const [only, setOnly] = useState<'all' | 'in' | 'out'>('all');
  if (!data) return <div className="skeleton" style={{ height: 300 }} />;
  const list = data.people.filter((p) => (!team || p.teamNumber === team) && (only === 'all' || (only === 'in' ? !!p.checkedInAt : !p.checkedInAt)) && (!q || p.name.includes(q.trim())));
  return (
    <div>
      <div className="between"><h1 className="h-title">체크인 현황</h1><button className="btn btn-ghost btn-s" onClick={() => void reload()}>새로고침</button></div>
      <p className="small muted">입장 <b className="num">{data.checkedIn}</b> / 활성 명단 {data.total}명. 체크인은 최초 로그인 성공 시 기록됩니다.</p>
      <div className="checkin-strip" style={{ marginTop: 12 }}>
        {data.teams.map((c) => (
          <button key={c.teamNumber} className="c" style={{ textAlign: 'left', borderStyle: team === c.teamNumber ? 'solid' : 'dashed', borderColor: team === c.teamNumber ? 'var(--green)' : undefined }} onClick={() => setTeam(team === c.teamNumber ? 0 : c.teamNumber)} aria-pressed={team === c.teamNumber}>
            <div className="xs muted">{c.teamNumber}조</div><b className="num">{c.checkedIn}</b><span className="xs muted num">/{c.total}</span>
            <div className="meter"><i style={{ width: `${c.total ? (c.checkedIn / c.total) * 100 : 0}%` }} /></div>
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
        <input className="input" style={{ maxWidth: 260, minHeight: 44 }} placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="이름 검색" />
        <div className="chips">{([['all', '전체'], ['in', '입장'], ['out', '미입장']] as const).map(([k, l]) => <button key={k} className="chip" aria-pressed={only === k} onClick={() => setOnly(k)}>{l}</button>)}</div>
      </div>
      <div className="panel" style={{ marginTop: 12, padding: '4px 16px' }}>
        {list.map((p) => (
          <div className="list-row" key={p.id}>
            <div>
              <div style={{ fontWeight: 700 }}>{p.name} <span className="xs muted">· {p.teamNumber}조 · {p.employeeId}</span> {p.role !== 'participant' && <span className="badge staff">{p.role === 'owner' ? 'OWNER' : '운영진'}</span>} {!p.active && <span className="badge gray">비활성</span>}</div>
              <div className="xs muted num">{p.checkedInAt ? `${fmtFull(p.checkedInAt)} 입장` : '미입장'}</div>
            </div>
            <span className="num" style={{ fontWeight: 800 }}>{p.ticketNumber ? `No.${formatTicket(p.ticketNumber)}` : '—'}</span>
          </div>
        ))}
        {!list.length && <p className="small muted" style={{ padding: 12 }}>조건에 맞는 사람이 없습니다.</p>}
      </div>
    </div>
  );
}
