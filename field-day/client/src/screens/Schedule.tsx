import { useState } from 'react';
import { useApi } from '../hooks';
import { useMe } from '../session';
import { cx, fmtTime, timeRange } from '../util';
import { IconChevron } from '../components/Icons';
import { ImageViewer } from '../components/ImageViewer';
import { ErrorLine } from './Pass';
import type { EventInfo, Game, NowNext, ScheduleItem } from '../types';

const STATUS_BADGE: Record<string, [string, string] | undefined> = {
  live: ['진행 중', 'lime'], delayed: ['지연', 'orange'], time_tbd: ['시간 확인 중', 'gray'], done: ['종료', 'gray'],
};

export function Schedule() {
  const [tab, setTab] = useState<'time' | 'games'>('time');
  return (
    <main className="page">
      <div className="topbar"><span className="eyebrow">SCHEDULE<span className="dot" />10.21 WED</span></div>
      <h1 className="h-title" style={{ marginTop: 8 }}>일정·경기</h1>
      <div className="seg" role="tablist" style={{ marginTop: 16 }}>
        <button role="tab" aria-selected={tab === 'time'} onClick={() => setTab('time')}>시간표</button>
        <button role="tab" aria-selected={tab === 'games'} onClick={() => setTab('games')}>메인 경기 4종</button>
      </div>
      <div style={{ marginTop: 16 }}>{tab === 'time' ? <Timeline /> : <Games />}</div>
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
                    {i.kind === 'main' && <span className="badge">메인</span>}
                    {i.kind === 'event' && <span className="badge orange">이벤트</span>}
                    <span>{i.title}</span>
                    {badge && <span className={`badge ${badge[1]}`}>{badge[0]}</span>}
                    {isNext && !isNow && <span className="badge">다음</span>}
                  </div>
                  {i.note && <div className="tl-note">{i.note}</div>}
                  {i.status === 'time_tbd' && <div className="tl-note">시작 시각은 운영진이 확인 중입니다.</div>}
                  {i.delayNote && <div className="tl-delay">{i.delayNote}</div>}
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

function Games() {
  const { me } = useMe();
  const { data, error, reload } = useApi<{ games: Game[] }>('/api/games', (ev) => ev.type === 'public_changed' && ev.data?.what === 'games');
  const [open, setOpen] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Game | null>(null);
  if (error && !data) return <ErrorLine onRetry={reload} />;
  if (!data) return <div className="skeleton" style={{ height: 320 }} />;
  return (
    <div>
      {data.games.map((g) => {
        const isOpen = open === g.key;
        return (
          <section className="game" key={g.key}>
            <button className="game-head" aria-expanded={isOpen} aria-controls={`g-${g.key}`} onClick={() => setOpen(isOpen ? null : g.key)}>
              <span className="game-no num">{g.number}</span>
              <span><span className="game-title">{g.title}</span><br /><span className="game-sub">{g.players}</span></span>
              <span className="chev"><IconChevron /></span>
            </button>
            {isOpen && (
              <div className="game-body" id={`g-${g.key}`}>
                {g.image && (
                  <button className="map-thumb game-photo" onClick={() => setPhoto(g)} aria-label={`${g.title} 예시 사진 크게 보기`} style={{ borderRadius: 12 }}>
                    <img src={g.image.replace('.jpg', '_thumb.jpg')} alt={`${g.title} 진행 방식 예시 사진`} loading="lazy" />
                    <figcaption>예시 사진 · 이번 행사 사진 아님</figcaption>
                  </button>
                )}
                <p style={{ marginTop: 12, fontWeight: 600 }}>{g.summary}</p>
                <ol className="steps">{g.howTo.split('\n').filter(Boolean).map((s, i) => <li key={i}>{s}</li>)}</ol>
                {g.bracket.length > 0 && (
                  <>
                    <div className="step-title">{g.key === 'balloon' ? '연합팀 구성' : '1라운드 대진'}</div>
                    <div className="bracket">
                      {g.bracket.map((b) => {
                        const mine = b.a === me.teamNumber || b.b === me.teamNumber;
                        return (
                          <div key={b.label} className={cx('m', mine && 'mine')}>
                            <div className="l">{b.label}{mine && ' · 우리 조'}</div>
                            <div className="vs num">{g.key === 'balloon' ? `${b.a}조 + ${b.b}조` : `${b.a}조 vs ${b.b}조`}</div>
                          </div>
                        );
                      })}
                    </div>
                    {g.bracketNote && <p className="small muted" style={{ marginTop: 8 }}>{g.bracketNote}</p>}
                  </>
                )}
                {g.pendingNote && <div className="note-card" style={{ marginTop: 12 }}><b>확정 전</b> · {g.pendingNote}</div>}
              </div>
            )}
          </section>
        );
      })}
      <p className="xs muted" style={{ marginTop: 12 }}>경기 진행과 판정은 현장 진행자·심판 안내를 따릅니다.</p>
      {photo?.image && <ImageViewer src={photo.image} alt={`${photo.title} 예시 사진`} title={`${photo.title} · 예시 사진`} onClose={() => setPhoto(null)} />}
    </div>
  );
}
