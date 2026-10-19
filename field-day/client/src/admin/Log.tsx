import { useState } from 'react';
import { useApi } from '../hooks';
import { cx, fmtFull } from '../util';
import { CancelDialog } from './CancelDialog';
import type { Category, LogEntry, TeamScore } from './types';
import { useToast } from '../components/Toast';

export function LogView({ categories, compact, onTeams }: { categories: Category[]; compact?: boolean; onTeams?: (t: TeamScore[]) => void }) {
  const toast = useToast();
  const [team, setTeam] = useState('');
  const [category, setCategory] = useState('');
  const [actor, setActor] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams({ ...(team && { team }), ...(category && { category }), ...(actor && { actor }), ...(status && { status }), limit: compact ? '6' : '300' }).toString();
  const { data, error, reload } = useApi<{ entries: LogEntry[]; actors: { id: string; name: string }[] }>(`/api/admin/scores/log?${qs}`, (ev) => ev.type === 'scores_changed');
  const [cancel, setCancel] = useState<LogEntry | null>(null);
  const entries = data?.entries ?? [];

  return (
    <div>
      {!compact && (
        <div className="filters panel" style={{ marginBottom: 12 }}>
          <label className="field"><span className="label">조</span>
            <select className="select" value={team} onChange={(e) => setTeam(e.target.value)}><option value="">전체</option>{Array.from({ length: 8 }, (_, i) => <option key={i} value={i + 1}>{i + 1}조</option>)}</select></label>
          <label className="field"><span className="label">종목</span>
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">전체</option>{categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label className="field"><span className="label">부여·취소자</span>
            <select className="select" value={actor} onChange={(e) => setActor(e.target.value)}><option value="">전체</option>{data?.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="field"><span className="label">상태</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체</option><option value="active">유효</option><option value="cancelled">취소</option></select></label>
          <a className="btn btn-ghost btn-s" href={`/api/admin/scores/export.csv?${qs.replace(/limit=\d+/, '')}`} download>CSV 내보내기</a>
        </div>
      )}
      {error && <div className="form-error">{error.message}</div>}
      {data && !entries.length && <div className="state-box"><h3>기록이 없습니다</h3><p className="small">{qs.includes('=') && !compact ? '필터 조건을 바꿔 보세요.' : '점수를 부여하면 여기에 표시됩니다.'}</p></div>}

      {/* 모바일: 카드형 */}
      <div className={cx('log-cards', !compact && 'only-mobile')}>
        {entries.map((e) => (
          <div key={e.id} className={cx('lc', e.status === 'cancelled' && 'cancelled')}>
            <div className="top">
              <div className="row"><b>{e.teamNumber}조</b><span className="small muted">{e.categoryLabel}{e.subtypeLabel ? ` · ${e.subtypeLabel}` : ''}</span></div>
              <span className="pts num">+{e.points}</span>
            </div>
            <div style={{ marginTop: 4, fontWeight: 600 }}>{e.reason}</div>
            <div className="meta num">{fmtFull(e.createdAt)} · 부여 {e.actorName} · ID {e.id.slice(0, 8)}</div>
            {e.reversal ? (
              <div className="rev"><b>취소됨</b> · {e.reversal.points}점 상쇄 · {e.reversal.actorName} · {fmtFull(e.reversal.createdAt)}<br />사유: {e.reversal.reason}</div>
            ) : (
              <div className="between" style={{ marginTop: 8 }}><span className="badge">유효</span><button className="btn btn-ghost btn-s" onClick={() => setCancel(e)}>취소</button></div>
            )}
          </div>
        ))}
      </div>

      {/* 데스크톱: 표형 */}
      {!compact && entries.length > 0 && (
        <div className="only-desktop table-scroll">
          <table className="log-table">
            <thead><tr><th>부여일시(KST)</th><th>조</th><th>종목</th><th>점수</th><th>사유</th><th>부여자</th><th>상태</th><th>기록 ID</th><th /></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className={cx(e.status === 'cancelled' && 'cancelled')}>
                  <td className="num">{fmtFull(e.createdAt)}</td>
                  <td><b>{e.teamNumber}조</b></td>
                  <td>{e.categoryLabel}{e.subtypeLabel ? <><br /><span className="xs muted">{e.subtypeLabel}</span></> : null}</td>
                  <td className="p num">+{e.points}</td>
                  <td>{e.reason}</td>
                  <td>{e.actorName}</td>
                  <td>{e.reversal ? <><span className="badge danger">취소됨</span><div className="xs" style={{ marginTop: 4 }}>{e.reversal.points}점 상쇄 · {e.reversal.actorName}<br />{fmtFull(e.reversal.createdAt)}<br />사유: {e.reversal.reason}</div></> : <span className="badge">유효</span>}</td>
                  <td className="xs num muted">{e.id.slice(0, 8)}</td>
                  <td>{!e.reversal && <button className="btn btn-ghost btn-s" onClick={() => setCancel(e)}>취소</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cancel && <CancelDialog entry={cancel} onClose={() => setCancel(null)} onDone={(t) => { setCancel(null); toast(`${cancel.teamNumber}조 ${cancel.points}점 취소 완료`); onTeams?.(t); void reload(); }} />}
    </div>
  );
}
