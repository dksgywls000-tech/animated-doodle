import { useState } from 'react';
import { useApi } from '../hooks';
import { cx, fmtTime, timeRange } from '../util';
import { ErrorLine } from './Pass';
import { ReturnBusCard } from '../components/ReturnBus';
import type { EventInfo, NowNext, ScheduleItem } from '../types';

const STATUS_BADGE: Record<string, [string, string] | undefined> = {
  live: ['진행 중', 'lime'], delayed: ['지연', 'orange'], time_tbd: ['시간 확인 중', 'gray'], done: ['종료', 'gray'],
};

export function Schedule() {
  return (
    <main className="page">
      <div className="topbar"><span className="eyebrow">SCHEDULE<span className="dot" />10.21 WED</span></div>
      <h1 className="h-title" style={{ marginTop: 8 }}>오늘 일정</h1>
      <div style={{ marginTop: 16 }}><Timeline /></div>
    </main>
  );
}

function Timeline() {
  const { data, error, reload } = useApi<{ event: EventInfo; items: ScheduleItem[]; nowNext: NowNext; lastUpdated: string }>(
    '/api/schedule', (ev) => ev.type === 'public_changed' && ['schedule', 'event'].includes(ev.data?.what),
  );
  const [showDone, setShowDone] = useState(false);
  if (error && !data) return <ErrorLine onRetry={reload} />;
  if (!data) return <div className="skeleton" style={{ height: 320 }} />;
  const { items, nowNext, event } = data;
  const done = items.filter((i) => i.status === 'done');
  const visible = showDone ? items : items.filter((i) => i.status !== 'done');
  return (
    <div>
      {!event.schedulePublished && <div className="note-card" style={{ marginBottom: 12 }}><b>초안</b> · 운영진 확정 전 시간표입니다. 현장 안내가 우선합니다.</div>}
      {event.statusNote && <div className="status-banner" style={{ marginBottom: 12 }}><div><b>운영 안내</b> {event.statusNote}</div></div>}
      {done.length > 0 && (
        <button className="fold-btn" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone} style={{ marginBottom: 8 }}>
          {showDone ? '종료된 순서 접기' : `종료된 순서 ${done.length}개 보기`}
        </button>
      )}
      <ol className="timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {visible.map((i) => {
          const isNow = nowNext.currentIds.includes(i.id);
          const isNext = nowNext.nextId === i.id;
          const badge = isNow && i.status !== 'live' ? (['지금', 'lime'] as [string, string]) : STATUS_BADGE[i.status];
          return (
            <li key={i.id} className={cx('tl-item', i.kind === 'main' && 'main', isNow && 'is-now', isNext && 'is-next', i.status === 'done' && 'is-done')} aria-current={isNow ? 'step' : undefined}>
              <div className="tl-time num">{i.status === 'time_tbd' && !i.startTime ? '—' : i.startTime ?? '—'}{i.endTime && <small>~{i.endTime}</small>}</div>
              <div className="tl-body">
                <div className="tl-card">
                  <div className="tl-title">
                    <span>{i.title}</span>
                    {badge && <span className={`badge ${badge[1]}`}>{badge[0]}</span>}
                    {isNext && !isNow && <span className="badge">다음</span>}
                  </div>
                  {i.note && !i.title.includes('퇴근버스') && <div className="tl-note">{i.note}</div>}
                  {i.status === 'time_tbd' && <div className="tl-note">시작 시각은 운영진이 확인 중입니다.</div>}
                  {i.delayNote && <div className="tl-delay">{i.delayNote}</div>}
                  {i.title.includes('퇴근버스') && <ReturnBusCard compact />}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="xs muted" style={{ marginTop: 12 }}>
        {nowNext.basis === 'manual' ? '‘진행 중’은 운영진이 지정한 상태입니다.' : '‘지금’은 예정 시각 기준 표시입니다.'} 마지막 변경 {fmtTime(data.lastUpdated)}
      </p>
    </div>
  );
}
