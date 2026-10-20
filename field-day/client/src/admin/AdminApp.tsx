import { useEffect, useMemo, useState } from 'react';
import { useApi, useConn } from '../hooks';
import { useMe } from '../session';
import { cx, fmtTime, TEAM_COLORS, teamLabel } from '../util';
import { IconPlus } from '../components/Icons';
import { AwardSheet } from './AwardSheet';
import { LogView } from './Log';
import { Ops } from './Ops';
import { Requests } from './Requests';
import { Checkins } from './Checkins';
import { Owner } from './Owner';
import { Tickets } from './Tickets';
import { CouponAdmin } from './CouponAdmin';
import type { Category, TeamScore } from './types';
import { useToast } from '../components/Toast';
import { realtime } from '../realtime';

const NAV = [
  ['', '점수판'], ['log', '점수 기록'], ['ops', '공지·일정'], ['tickets', '행운권'], ['coupon', '쿠폰'], ['requests', '요청·신고'], ['checkins', '체크인'],
] as const;

export default function AdminApp({ route, go }: { route: string; go: (r: string) => void }) {
  const { me } = useMe();
  const conn = useConn();
  const sub = route.split('/')[2] ?? '';
  const cats = useApi<{ categories: Category[] }>('/api/admin/scores/categories');
  const [badge, setBadge] = useState({ help: 0, reports: 0 });
  useEffect(() => realtime.on((ev) => {
    if (ev.type === 'help_changed' && sub !== 'requests') setBadge((b) => ({ ...b, help: b.help + 1 }));
    if (ev.type === 'reports_changed' && sub !== 'requests') setBadge((b) => ({ ...b, reports: b.reports + 1 }));
  }), [sub]);
  useEffect(() => { if (sub === 'requests') setBadge({ help: 0, reports: 0 }); window.scrollTo(0, 0); }, [sub]);

  const nav = [...NAV, ...(me.role === 'owner' ? [['owner', '명단·권한'] as const] : [])];
  return (
    <div className="admin">
      <header className="admin-top">
        <div className="admin-top-inner">
          <div className="brand"><span className="tag">ADMIN</span><span>가을운동회 운영</span>
            <span className="xs" style={{ color: conn === 'online' ? 'var(--lime)' : 'var(--orange)', fontWeight: 700 }}>{conn === 'online' ? '● 실시간' : '연결 끊김'}</span>
          </div>
          <button className="btn btn-s btn-back" onClick={() => go('/pass')}>참가자 화면으로</button>
        </div>
        <nav className="admin-nav" aria-label="관리자 메뉴">
          {nav.map(([k, l]) => (
            <button key={k} aria-current={sub === k ? 'page' : undefined} onClick={() => go('/admin' + (k ? '/' + k : ''))}>
              {l}{k === 'requests' && badge.help + badge.reports > 0 && <span className="count num">{badge.help + badge.reports}</span>}
            </button>
          ))}
        </nav>
      </header>
      <main className="admin-main">
        {!cats.data ? <div className="skeleton" style={{ height: 300 }} /> : (
          <>
            {sub === '' && <Board categories={cats.data.categories} go={go} />}
            {sub === 'log' && <><h1 className="h-title" style={{ marginBottom: 12 }}>점수 기록</h1><LogView categories={cats.data.categories} /></>}
            {sub === 'ops' && <Ops />}
            {sub === 'requests' && <Requests />}
            {sub === 'checkins' && <Checkins />}
            {sub === 'tickets' && <Tickets />}
            {sub === 'coupon' && <CouponAdmin />}
            {sub === 'owner' && me.role === 'owner' && <Owner />}
          </>
        )}
      </main>
    </div>
  );
}

function Board({ categories, go }: { categories: Category[]; go: (r: string) => void }) {
  const toast = useToast();
  const board = useApi<{ teams: TeamScore[]; generatedAt: string }>('/api/admin/scores/board', (ev) => ev.type === 'scores_changed');
  const checkins = useApi<{ teams: { teamNumber: number; total: number; checkedIn: number }[]; total: number; checkedIn: number }>('/api/admin/checkins/summary');
  const [sort, setSort] = useState<'team' | 'rank'>('team');
  const [award, setAward] = useState<{ team: number | null } | null>(null);
  const [flash, setFlash] = useState<number | null>(null);

  const teams = useMemo(() => {
    const t = [...(board.data?.teams ?? [])];
    return sort === 'rank' ? t.sort((a, b) => a.rank - b.rank || a.teamNumber - b.teamNumber) : t;
  }, [board.data, sort]);

  const onAwarded = (t: TeamScore[], team: number | null) => {
    board.setData({ teams: t, generatedAt: new Date().toISOString() });
    if (team) { setFlash(team); setTimeout(() => setFlash(null), 1000); }
  };

  return (
    <div>
      <div className="between" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="h-title">점수판</h1>
          <p className="xs muted">관리자 전용 · {board.data ? `${fmtTime(board.data.generatedAt)} 기준` : '불러오는 중'} · 동점은 공동 순위</p>
        </div>
        <div className="row">
          <div className="seg" role="tablist" aria-label="정렬" style={{ minWidth: 200 }}>
            <button role="tab" aria-selected={sort === 'team'} onClick={() => setSort('team')}>조 번호순</button>
            <button role="tab" aria-selected={sort === 'rank'} onClick={() => setSort('rank')}>순위순</button>
          </div>
          <button className="btn btn-primary" onClick={() => setAward({ team: null })}><IconPlus size={20} />점수 부여</button>
        </div>
      </div>

      <div className="board" style={{ marginTop: 16 }}>
        {board.error && <div className="form-error">{board.error.message}</div>}
        {teams.map((t) => (
          <button key={t.teamNumber} className={cx('team-card', flash === t.teamNumber && 'flash')} style={{ ['--team' as string]: TEAM_COLORS[t.teamNumber] }}
            onClick={() => setAward({ team: t.teamNumber })} aria-label={`${t.name} ${t.total}점 ${t.rank}위, 점수 부여`}>
            <div className="between"><span className="nm">{t.name}</span><span className={cx('rank num', t.rank === 1 && t.total > 0 && 'top')}>{t.rank}위{teams.filter((o) => o.rank === t.rank).length > 1 ? ' (공동)' : ''}</span></div>
            <div className="pts num">{t.total.toLocaleString()}<small>점</small></div>
            <span className="add"><IconPlus size={16} />점수 부여</span>
          </button>
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 24 }}>
        <section className="panel">
          <div className="between" style={{ marginBottom: 8 }}><h2 className="h-sec">최근 기록</h2><button className="btn btn-plain small" onClick={() => go('/admin/log')}>전체 기록·필터</button></div>
          <LogView categories={categories} compact onTeams={(t) => onAwarded(t, null)} />
        </section>
        <section>
          <div className="between" style={{ marginBottom: 8 }}><h2 className="h-sec">체크인 현황</h2><button className="btn btn-plain small" onClick={() => { void checkins.reload(); }}>새로고침</button></div>
          {checkins.data && (
            <>
              <p className="small muted" style={{ marginBottom: 8 }}>입장 <b className="num" style={{ color: 'var(--ink)' }}>{checkins.data.checkedIn}</b> / 명단 {checkins.data.total}명 · 점수와 무관한 출석 정보입니다.</p>
              <div className="checkin-strip">
                {checkins.data.teams.map((c) => (
                  <div className="c" key={c.teamNumber}>
                    <div className="xs muted">{teamLabel(c.teamNumber)}</div>
                    <b className="num">{c.checkedIn}</b><span className="xs muted num">/{c.total}</span>
                    <div className="meter"><i style={{ width: `${c.total ? (c.checkedIn / c.total) * 100 : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {award && (
        <AwardSheet categories={categories} initialTeam={award.team} onClose={() => setAward(null)}
          onDone={(t, team) => { onAwarded(t, team); toast('점수가 반영되었습니다'); }} />
      )}
    </div>
  );
}
