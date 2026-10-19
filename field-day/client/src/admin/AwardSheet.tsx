import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useMe } from '../session';
import { uid } from '../util';
import { Sheet } from '../components/Sheet';
import { ScoreWheel, QUICK } from './ScoreWheel';
import type { Category, TeamScore } from './types';

const MAIN_PRESETS = ['1위', '2위', '3위', '4위', '참가'];
const EVENT_PRESETS: Record<string, string[]> = {
  balloon_pop: ['1위', '2위', '3위'],
  event_jumprope: ['승리', '참여'],
  jegi: ['합산보다 많이 찬 선수 1명', '합산보다 많이 찬 선수 2명', '합산보다 많이 찬 선수 3명'],
  event_tube: ['승리', '참여'],
  other: [],
};
const CHEER_PRESETS = ['응원 열정', '단합·질서', '응원 도구·퍼포먼스'];

type Phase = 'edit' | 'confirm' | 'sending' | 'unknown' | 'done';

export function AwardSheet({ categories, initialTeam, onClose, onDone }: {
  categories: Category[]; initialTeam: number | null; onClose: () => void; onDone: (teams: TeamScore[], team: number) => void;
}) {
  const { me } = useMe();
  const [team, setTeam] = useState<number | null>(initialTeam);
  const [cat, setCat] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [phase, setPhase] = useState<Phase>('edit');
  const [err, setErr] = useState<string | null>(null);
  const [dupWarn, setDupWarn] = useState<string | null>(null);
  const idemKey = useRef(uid());
  const live = useRef<HTMLDivElement>(null);

  const category = categories.find((c) => c.key === cat);
  const subtype = category?.subtypes.find((s) => s.key === sub);
  const shortLabel = category ? category.label.replace(/^\d+\.\s*/, '') : '';
  const presets = !category ? [] : category.kind === 'main' ? MAIN_PRESETS : category.kind === 'cheer' ? CHEER_PRESETS : EVENT_PRESETS[sub ?? ''] ?? [];
  const needDetail = category?.kind !== 'main' || preset === '__custom';

  const reason = useMemo(() => {
    if (!category) return '';
    if (category.kind === 'main') return preset === '__custom' ? detail.trim() : preset ? `${shortLabel} ${preset}` : '';
    const d = detail.trim();
    if (!d) return '';
    return category.kind === 'event' ? `${subtype?.label ?? '이벤트'} · ${d}` : `응원 · ${d}`;
  }, [category, preset, detail, shortLabel, subtype]);

  const reasonOk = category?.kind === 'main' ? (preset === '__custom' ? detail.trim().length >= 1 : !!preset) : detail.trim().length >= 2;
  const ready = !!team && !!category && (category.kind !== 'event' || !!sub) && points != null && reasonOk;

  // 입력이 바뀌면 새 요청으로 취급(새 idempotency key)
  useEffect(() => { if (phase === 'edit') idemKey.current = uid(); setDupWarn(null); }, [team, cat, sub, points, reason]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (confirmDuplicate = false) => {
    if (!ready || phase === 'sending') return;
    setPhase('sending'); setErr(null);
    try {
      const r = await api<{ teams: TeamScore[]; replay: boolean }>('POST', '/api/admin/scores/awards', {
        teamNumber: team, categoryKey: cat, subtypeKey: category?.kind === 'event' ? sub : undefined, points, reason, idempotencyKey: idemKey.current, confirmDuplicate,
      });
      setPhase('done');
      onDone(r.teams, team!);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_warning') { setDupWarn(e.message); setPhase('confirm'); return; }
      if (e instanceof ApiError && e.unknownOutcome) { setPhase('unknown'); return; }
      setErr(e instanceof ApiError ? e.message : '부여하지 못했습니다. 다시 시도해 주세요.');
      setPhase('confirm');
    }
  };

  const summary = (
    <div className="pick-sum" aria-live="polite">
      <span>{team ? `${team}조` : '조 선택'}</span><span className="sep">/</span>
      <span>{category ? (category.kind === 'event' && subtype ? subtype.label : shortLabel) : '종목'}</span><span className="sep">/</span>
      <span className="pts num">{points ? `+${points}점` : '점수'}</span>
    </div>
  );

  if (phase === 'done') {
    return (
      <Sheet title="점수 부여 완료" onClose={onClose} footer={<button className="btn btn-primary btn-block" onClick={onClose} data-autofocus>확인</button>}>
        <div className="form-ok" role="status">{team}조에 {points}점을 부여했습니다. 서버에 기록되었습니다.</div>
        <p className="small muted" style={{ marginTop: 12 }}>사유: {reason}</p>
      </Sheet>
    );
  }

  const confirmPhase = phase === 'confirm' || phase === 'sending' || phase === 'unknown';
  return (
    <Sheet title={confirmPhase ? '최종 확인' : '점수 부여'} onClose={onClose} wide closeDisabled={phase === 'sending'}
      footer={confirmPhase ? (
        phase === 'unknown' ? (
          <div className="stack-s">
            <div className="warn-card" role="alert">네트워크 문제로 처리 결과를 확인하지 못했습니다. 아래 버튼은 <b>같은 요청</b>을 다시 보내므로 이미 반영되었다면 중복 부여되지 않습니다.</div>
            <button className="btn btn-primary btn-block" onClick={() => void send()}>결과 확인 후 재시도 (중복 없음)</button>
            <button className="btn btn-ghost btn-block" onClick={onClose}>닫고 기록에서 확인</button>
          </div>
        ) : (
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setPhase('edit')} disabled={phase === 'sending'}>수정</button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void send(!!dupWarn)} disabled={phase === 'sending'} data-autofocus>
              {phase === 'sending' ? <><span className="spinner" aria-hidden="true" />서버 확인 중…</> : dupWarn ? `그래도 ${team}조에 ${points}점 한 번 더 부여` : `${team}조에 ${points}점 부여`}
            </button>
          </div>
        )
      ) : (
        <button className="btn btn-primary btn-block" disabled={!ready} onClick={() => setPhase('confirm')}>{ready ? '확인 단계로' : '모든 항목을 선택해 주세요'}</button>
      )}>
      <div className="pick-head">{summary}</div>
      <div ref={live} className="sr-only" aria-live="assertive">{err}</div>

      {confirmPhase ? (
        <div className="confirm-box">
          <dl>
            <dt>대상</dt><dd>{team}조</dd>
            <dt>종목</dt><dd>{category?.label}{subtype ? ` · ${subtype.label}` : ''}</dd>
            <dt>점수</dt><dd className="num" style={{ fontSize: 22 }}>+{points}점</dd>
            <dt>사유</dt><dd>{reason}</dd>
            <dt>부여자</dt><dd>{me.name}</dd>
          </dl>
          {dupWarn && <div className="warn-card" role="alert" style={{ marginTop: 12 }}>{dupWarn}</div>}
          {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
        </div>
      ) : (
        <>
          <div className="step-title"><span className="n">1</span>조 선택</div>
          <div className="team-grid" role="group" aria-label="조 선택">
            {Array.from({ length: 8 }, (_, i) => i + 1).map((t) => <button key={t} className="opt num" aria-pressed={team === t} onClick={() => setTeam(t)}>{t}조</button>)}
          </div>

          <div className="step-title"><span className="n">2</span>종목 선택</div>
          <div className="opt-grid" role="group" aria-label="종목 선택">
            {categories.map((c) => <button key={c.key} className="opt" aria-pressed={cat === c.key} onClick={() => { setCat(c.key); setSub(null); setPreset(null); setDetail(''); }}>{c.label}</button>)}
          </div>
          {category?.kind === 'event' && (
            <>
              <div className="step-title" style={{ fontSize: 14 }}>이벤트 세부 유형</div>
              <div className="chips" role="group" aria-label="이벤트 세부 유형">
                {category.subtypes.map((s) => <button key={s.key} className="chip" aria-pressed={sub === s.key} onClick={() => { setSub(s.key); setDetail(''); }}>{s.label}</button>)}
              </div>
            </>
          )}

          <div className="step-title"><span className="n">3</span>점수 선택</div>
          <div className="chips" role="group" aria-label="빠른 점수 선택" style={{ marginBottom: 10 }}>
            {QUICK.map((q) => <button key={q} className="chip num" aria-pressed={points === q} onClick={() => setPoints(q)}>{q}</button>)}
          </div>
          <ScoreWheel value={points} onChange={setPoints} />
          <p className="hint">10~200점, 10점 단위. 휠을 돌리거나 위아래 화살표 키로 조절합니다.</p>

          <div className="step-title"><span className="n">4</span>사유</div>
          {!category ? <p className="small muted">종목을 먼저 선택해 주세요.</p> : (
            <>
              {presets.length > 0 && (
                <div className="chips" role="group" aria-label="사유 프리셋" style={{ marginBottom: 10 }}>
                  {presets.map((p) => (
                    <button key={p} className="chip" aria-pressed={category.kind === 'main' ? preset === p : detail === p}
                      onClick={() => (category.kind === 'main' ? setPreset(p) : setDetail(p))}>{p}</button>
                  ))}
                  {category.kind === 'main' && <button className="chip" aria-pressed={preset === '__custom'} onClick={() => setPreset('__custom')}>직접 입력</button>}
                </div>
              )}
              {needDetail && (
                <label className="field">
                  <span className="label">{category.kind === 'main' ? '사유 직접 입력' : '구체적인 사유 (필수)'}</span>
                  <input className="input" value={detail} maxLength={150} onChange={(e) => setDetail(e.target.value)}
                    placeholder={category.kind === 'cheer' ? '예: 줄넘기 경기 중 응원 열정' : '예: 제기차기 합산 초과 2명'} />
                </label>
              )}
              {reason && <p className="small" style={{ marginTop: 8 }}>기록될 사유: <b>{reason}</b></p>}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
