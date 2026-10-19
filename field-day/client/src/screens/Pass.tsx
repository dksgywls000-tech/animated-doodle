import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import { useMe } from '../session';
import { cx, fmtTime, formatTicket, TEAM_COLORS, timeRange, fmtFull } from '../util';
import { TicketFull } from '../components/TicketFull';
import { HelpSheet } from '../components/HelpSheet';
import { IconBell, IconExpand, IconHelp, IconSeat } from '../components/Icons';
import { Sheet } from '../components/Sheet';
import type { Announcement, ScheduleItem, NowNext, EventInfo } from '../types';

export function Pass({ go, fresh }: { go: (r: string) => void; fresh: boolean }) {
  const { me, logout } = useMe();
  const [full, setFull] = useState(false);
  const [help, setHelp] = useState(false);
  const [allAnn, setAllAnn] = useState(false);
  const home = useApi<{ event: EventInfo; nowNext: NowNext; current: ScheduleItem[]; next: ScheduleItem | null; announcements: Announcement[] }>(
    '/api/home', (ev) => ev.type === 'public_changed',
  );
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  useEffect(() => { if (home.data) setLoadedAt(new Date()); }, [home.data]);
  // 현재/다음은 분 단위로 다시 계산
  useEffect(() => { const t = setInterval(() => void home.reload(), 60_000); return () => clearInterval(t); }, [home.reload]);

  const h = home.data;
  const teamColor = TEAM_COLORS[me.teamNumber];

  return (
    <main className="page">
      <div className="topbar">
        <span className="eyebrow">AUTUMN FIELD CLUB<span className="dot" />10.21</span>
        <button className="btn btn-plain small" onClick={() => setHelp(true)}><IconHelp size={20} />도움 요청</button>
      </div>

      <div style={{ marginTop: 12 }}>
        <p className="muted small">2026 하이테크본부 가을운동회</p>
        <h1 className="h-title">{me.name}님, 반가워요</h1>
        <p className="xs muted num" style={{ marginTop: 2 }}>사번 {me.employeeIdMasked}</p>
      </div>

      <section aria-label="내 조와 행운권" className={cx('ticket', fresh && 'reveal')} style={{ marginTop: 16, ['--team' as string]: teamColor }}>
        <div className="ticket-field" />
        <div className="ticket-top">
          <div>
            <div className="ticket-label">MY TEAM · 내 조</div>
            <div className="ticket-team"><span className="swatch" aria-hidden="true" /><span className="big">{me.teamName}</span></div>
            <div className="ticket-seat">{me.seatNote}</div>
          </div>
          <div className="stamp" aria-hidden="true"><span>OCT<b>21</b>WED</span></div>
        </div>
        <div className="perf" aria-hidden="true"><span /></div>
        <div className="ticket-bottom">
          <div className="ticket-label">LUCKY TICKET · 행운권</div>
          <div className="ticket-no num" aria-label={`행운권 ${formatTicket(me.ticketNumber)}번`}><small>No.</small>{formatTicket(me.ticketNumber)}</div>
          <div className="ticket-actions">
            <button className="btn btn-lime" onClick={() => setFull(true)}><IconExpand size={18} />행운권 크게 보기</button>
            <button className="btn btn-on-dark" onClick={() => go('/map/seat')}><IconSeat size={18} />내 조 자리</button>
          </div>
        </div>
      </section>

      {h?.event.statusNote && (
        <div className="status-banner" role="status" style={{ marginTop: 16 }}>
          <IconBell size={20} />
          <div><b>운영 안내</b> {h.event.statusNote}{h.event.statusNoteUpdatedAt && <span className="xs" style={{ opacity: .7 }}> · {fmtTime(h.event.statusNoteUpdatedAt)}</span>}</div>
        </div>
      )}

      <div className="sec-head">
        <h2 className="h-sec">지금 · 다음</h2>
        <span className="meta">{loadedAt ? `${fmtTime(loadedAt)} 갱신` : ''}</span>
      </div>
      {home.loading && !h ? <div className="skeleton" style={{ height: 96 }} /> : h ? <NowNextCard h={h} go={go} /> : <ErrorLine onRetry={home.reload} />}

      <div className="sec-head">
        <h2 className="h-sec">공지</h2>
        {!!h?.announcements.length && <button className="btn btn-plain small" onClick={() => setAllAnn(true)}>전체 보기</button>}
      </div>
      {h && (h.announcements.length ? <AnnList items={h.announcements.slice(0, 3)} onRead={home.reload} /> : <p className="muted small">아직 등록된 공지가 없습니다.</p>)}

      <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
        <button className="btn btn-ghost btn-s" onClick={() => void logout()}>로그아웃</button>
      </div>

      {full && <TicketFull me={me} onClose={() => setFull(false)} />}
      {help && <HelpSheet onClose={() => setHelp(false)} go={go} />}
      {allAnn && <Sheet title="공지" onClose={() => setAllAnn(false)}><AllAnnouncements /></Sheet>}
    </main>
  );
}

function NowNextCard({ h, go }: { h: { nowNext: NowNext; current: ScheduleItem[]; next: ScheduleItem | null; event: EventInfo }; go: (r: string) => void }) {
  const cur = h.current;
  return (
    <div>
      <button className="nownext" onClick={() => go('/schedule')} style={{ width: '100%', textAlign: 'left', padding: 0 }} aria-label="일정 전체 보기">
        <div>
          <div className="k">{cur.length ? <span className="live" aria-hidden="true" /> : null}지금</div>
          {cur.length ? cur.map((c) => (
            <div key={c.id}>
              <div className="t">{c.title}</div>
              <div className="s num">{c.status === 'time_tbd' ? '시간 확인 중' : timeRange(c.startTime, c.endTime)}</div>
            </div>
          )) : <div className="t" style={{ color: 'var(--ink-3)' }}>{h.nowNext.beforeEvent ? '행사 전' : '진행 중인 순서 없음'}</div>}
        </div>
        <div>
          <div className="k">다음</div>
          {h.next ? (
            <>
              <div className="t">{h.next.title}</div>
              <div className="s num">{h.next.status === 'time_tbd' ? '시간 확인 중' : timeRange(h.next.startTime, h.next.endTime)}</div>
              {h.next.delayNote && <div className="s" style={{ color: 'var(--orange-text)', fontWeight: 700 }}>{h.next.delayNote}</div>}
            </>
          ) : <div className="t" style={{ color: 'var(--ink-3)' }}>—</div>}
        </div>
      </button>
      <p className="xs muted" style={{ marginTop: 6 }}>
        {h.nowNext.basis === 'manual' ? '운영진이 지정한 진행 상태입니다.' : h.nowNext.basis === 'time' ? '예정 시각 기준 안내입니다. 현장 진행에 따라 달라질 수 있어요.' : '행사 당일 10월 21일에 진행 순서가 표시됩니다.'}
        {!h.event.schedulePublished && ' 일정은 운영진 확정 전 초안입니다.'}
      </p>
    </div>
  );
}

export function AnnList({ items, onRead }: { items: Announcement[]; onRead?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = async (a: Announcement) => {
    setOpen((o) => (o === a.id ? null : a.id));
    if (!a.read) { try { await api('POST', `/api/announcements/${a.id}/read`); onRead?.(); } catch { /* 다음에 다시 */ } }
  };
  return (
    <div>
      {items.map((a) => (
        <button key={a.id} className={cx('ann', a.important && 'important')} onClick={() => void toggle(a)} aria-expanded={open === a.id}>
          <div className="ttl">
            {!a.read && <span className="unread" aria-label="읽지 않음" />}
            {a.important && <span className="badge orange">중요</span>}
            <span>{a.title}</span>
          </div>
          {(open === a.id || items.length === 1) && a.body && <div className="body">{a.body}</div>}
          <div className="when">{fmtFull(a.updatedAt ?? a.createdAt)}</div>
        </button>
      ))}
    </div>
  );
}

function AllAnnouncements() {
  const { data, reload } = useApi<{ announcements: Announcement[] }>('/api/announcements', (ev) => ev.type === 'public_changed' && ev.data?.what === 'announcements');
  if (!data) return <div className="skeleton" style={{ height: 120 }} />;
  if (!data.announcements.length) return <p className="muted">등록된 공지가 없습니다.</p>;
  return <AnnList items={data.announcements} onRead={reload} />;
}

export function ErrorLine({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="warn-card between">
      <span>정보를 불러오지 못했습니다.</span>
      <button className="btn btn-ghost btn-s" onClick={onRetry}>다시 시도</button>
    </div>
  );
}
