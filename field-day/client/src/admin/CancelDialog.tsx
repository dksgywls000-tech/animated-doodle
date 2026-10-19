import { useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { fmtFull, uid } from '../util';
import { Sheet } from '../components/Sheet';
import type { LogEntry, TeamScore } from './types';

export function CancelDialog({ entry, onClose, onDone }: { entry: LogEntry; onClose: () => void; onDone: (teams: TeamScore[]) => void }) {
  const [reason, setReason] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const key = useRef(uid());

  const submit = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setUnknown(false);
    try {
      const r = await api<{ teams: TeamScore[] }>('POST', `/api/admin/scores/awards/${entry.id}/cancel`, { password: pw, reason, idempotencyKey: key.current });
      setPw('');
      onDone(r.teams);
    } catch (e) {
      if (e instanceof ApiError && e.unknownOutcome) setUnknown(true);
      else setErr(e instanceof ApiError ? e.message : '취소하지 못했습니다.');
      if (e instanceof ApiError && e.code === 'bad_password') setPw('');
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="점수 취소" onClose={onClose} closeDisabled={busy}
      footer={<button className="btn btn-danger btn-block" disabled={busy || reason.trim().length < 2 || !pw} onClick={() => void submit()}>
        {busy ? '처리 중…' : `취소하고 ${entry.points}점 상쇄 (−${entry.points})`}
      </button>}>
      <div className="confirm-box" style={{ borderColor: 'var(--danger)' }}>
        <dl>
          <dt>대상</dt><dd>{entry.teamNumber}조</dd>
          <dt>원점수</dt><dd className="num">+{entry.points}점</dd>
          <dt>종목</dt><dd>{entry.categoryLabel}{entry.subtypeLabel ? ` · ${entry.subtypeLabel}` : ''}</dd>
          <dt>원부여자</dt><dd>{entry.actorName}</dd>
          <dt>원사유</dt><dd>{entry.reason}</dd>
          <dt>부여 시각</dt><dd className="num">{fmtFull(entry.createdAt)}</dd>
        </dl>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>취소하면 원기록은 그대로 남고 정확히 −{entry.points}점 상쇄 기록이 추가됩니다. 취소는 되돌릴 수 없으며, 다시 필요하면 새로 부여합니다.</p>
      <label className="field" style={{ marginTop: 14 }}>
        <span className="label">취소 사유</span>
        <input className="input" value={reason} maxLength={150} onChange={(e) => setReason(e.target.value)} placeholder="예: 다른 조에 잘못 입력" data-autofocus />
      </label>
      <label className="field" style={{ marginTop: 12 }}>
        <span className="label">취소 비밀번호</span>
        <input className="input" type="password" inputMode="numeric" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!err} aria-describedby={err ? 'cancel-err' : undefined} />
      </label>
      {err && <div className="form-error" id="cancel-err" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      {unknown && <div className="warn-card" role="alert" style={{ marginTop: 12 }}>처리 결과를 확인하지 못했습니다. 다시 누르면 같은 요청으로 처리되어 중복 차감되지 않습니다.</div>}
    </Sheet>
  );
}
