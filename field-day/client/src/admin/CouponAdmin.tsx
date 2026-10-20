import { useState } from 'react';
import { api, errMsg } from '../api';
import { useApi } from '../hooks';
import { useToast } from '../components/Toast';
import { fmtTime, teamLabel } from '../util';
import { Sheet } from '../components/Sheet';

interface Winner { pid: string; name: string; teamNumber: number; scratchedAt: string | null; claimedAt: string | null }
interface Excluded { pid: string; name: string; teamNumber: number }
interface Coupon { active: boolean; id: string; title: string; winners: number; eligible: number; deployedAt: string }

/** 스크래치 쿠폰 배포 — 당첨 개수를 정해 배포하면 그 순간 입장해 있던 사람에게 쿠폰이 열린다 */
export function CouponAdmin() {
  const toast = useToast();
  const st = useApi<{ coupon: Coupon | null; winners: Winner[]; scratched: number; excluded: Excluded[] }>('/api/admin/coupon', (ev) => ev.type === 'public_changed');
  const [count, setCount] = useState('10');
  const [title, setTitle] = useState('텀블러');
  const [names, setNames] = useState('');
  const [exMsg, setExMsg] = useState<{ added: string[]; problems: string[] } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c = st.data?.coupon;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr(null);
    try { await fn(); toast(done); await st.reload(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); setConfirm(false); }
  };
  const deploy = () => run(() => api('POST', '/api/admin/coupon/deploy', { count: Number(count), title }), '쿠폰을 배포했습니다');
  const stop = () => run(() => api('POST', '/api/admin/coupon/stop'), '쿠폰을 마감했습니다');
  const addEx = () => run(async () => { const r = await api<{ added: string[]; problems: string[] }>('POST', '/api/admin/coupon/exclude', { names }); setExMsg(r); if (!r.problems.length) setNames(''); }, '당첨 제외 명단을 저장했습니다');
  const delEx = (x: Excluded) => run(() => api('DELETE', `/api/admin/coupon/exclude/${x.pid}`), `${x.name}님을 제외 명단에서 뺐습니다`);
  const claim = (w: Winner) => run(() => api('POST', `/api/admin/coupon/claim/${w.pid}`, { claimed: !w.claimedAt }), w.claimedAt ? '수령 표시를 취소했습니다' : `${w.name}님 수령 완료`);

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 className="h-title">스크래치 쿠폰</h1>
      <p className="xs muted" style={{ marginBottom: 12 }}>
        배포 버튼을 누른 순간 <b>입장해 있는 모든 사람(운영진 포함)</b>에게 쿠폰이 열리고, 그중 정한 개수만큼 무작위로 당첨됩니다. 당첨자는 배포 순간 정해지며 바꿀 수 없습니다.
      </p>

      {c?.active ? (
        <section className="panel">
          <div className="between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div className="xs muted">진행 중 · {fmtTime(c.deployedAt)} 배포</div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{c.title} {c.winners}개</div>
              <div className="small muted">대상 {c.eligible}명 · 긁은 사람 <b className="num" style={{ color: 'var(--ink)' }}>{st.data!.scratched}</b>명</div>
            </div>
            {confirm
              ? <div className="row"><button className="btn btn-danger" disabled={busy} onClick={() => void stop()}>마감하기</button><button className="btn btn-ghost" onClick={() => setConfirm(false)}>취소</button></div>
              : <button className="btn btn-ghost" onClick={() => setConfirm(true)}>쿠폰 마감</button>}
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 2, minWidth: 160 }}>
              <span className="label">경품 이름</span>
              <input className="input" value={title} maxLength={30} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              <span className="label">당첨 개수</span>
              <input className="input num" inputMode="numeric" aria-label="당첨 개수" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 22, fontWeight: 800 }} />
            </label>
          </div>
          <div style={{ marginTop: 14 }}>
            {confirm ? (
              <div className="warn-card" role="alert">
                <b>{title || '텀블러'} {count}개</b>로 배포할까요? 지금 입장해 있는 사람에게 바로 쿠폰이 열립니다.
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary" disabled={busy} onClick={() => void deploy()}>{busy ? '배포 중…' : '배포'}</button>
                  <button className="btn btn-ghost" onClick={() => setConfirm(false)}>취소</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-primary btn-block" disabled={!Number(count)} onClick={() => setConfirm(true)}>쿠폰 배포</button>
            )}
          </div>
          {c && !c.active && <p className="xs muted" style={{ marginTop: 10 }}>지난 쿠폰: {c.title} {c.winners}개 · {fmtTime(c.deployedAt)} 배포 · 마감됨. 새로 배포하면 새 쿠폰이 열립니다.</p>}
        </section>
      )}
      <section className="panel" style={{ marginTop: 16 }} aria-label="당첨 제외 명단">
        <div className="between" style={{ marginBottom: 6 }}>
          <h2 className="h-sec">당첨 제외 {st.data?.excluded.length ?? 0}명</h2>
          <span className="xs muted">관리자 화면에만 보임</span>
        </div>
        <p className="xs muted" style={{ marginBottom: 8 }}>
          여기 있는 사람도 쿠폰은 똑같이 받고 긁을 수 있지만 <b>항상 꽝</b>이 나옵니다. 참가자 화면에는 제외 사실이 표시되지 않습니다. 다음 배포부터 적용됩니다.
        </p>
        {!!st.data?.excluded.length && (
          <div className="chips" style={{ marginBottom: 10 }}>
            {st.data.excluded.map((x) => (
              <button key={x.pid} className="chip" disabled={busy} onClick={() => void delEx(x)} aria-label={`${x.name} 제외 해제`}>
                {x.name} · {teamLabel(x.teamNumber)} ✕
              </button>
            ))}
          </div>
        )}
        <label className="field">
          <span className="label">추가할 이름 (줄바꿈·쉼표로 여러 명, 동명이인은 '홍길동 3조')</span>
          <textarea className="input" rows={3} value={names} onChange={(e) => setNames(e.target.value)} aria-label="제외할 이름" placeholder={'예: 홍길동 1조\n김철수 2조'} />
        </label>
        <button className="btn btn-ghost" style={{ marginTop: 8 }} disabled={busy || !names.trim()} onClick={() => void addEx()}>제외 명단에 추가</button>
        {exMsg && (
          <div className="xs" style={{ marginTop: 8 }} role="status">
            {exMsg.added.length > 0 && <div>추가: {exMsg.added.join(', ')}</div>}
            {exMsg.problems.map((p) => <div key={p} style={{ color: 'var(--orange-text)' }}>{p}</div>)}
          </div>
        )}
      </section>

      {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}

      {c && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="between" style={{ marginBottom: 8 }}>
            <h2 className="h-sec">당첨자 {st.data!.winners.length}명</h2>
            <span className="xs muted">수령 {st.data!.winners.filter((w) => w.claimedAt).length}명</span>
          </div>
          {st.data!.winners.map((w) => (
            <div className="list-row" key={w.pid} style={{ alignItems: 'center' }}>
              <span><b>{w.name}</b> <span className="xs muted">{teamLabel(w.teamNumber)} · {w.scratchedAt ? `${fmtTime(w.scratchedAt)} 확인` : '아직 안 긁음'}</span></span>
              <button className={w.claimedAt ? 'btn btn-s btn-ghost' : 'btn btn-s btn-primary'} disabled={busy} onClick={() => void claim(w)}>
                {w.claimedAt ? '수령 완료 ✓' : '수령 처리'}
              </button>
            </div>
          ))}
        </section>
      )}

      <ResetCoupon onDone={() => void st.reload()} />
    </div>
  );
}

/** 쿠폰 초기화(테스트용) — 배포·긁은 기록·수령 기록을 모두 지운다. 당첨 제외 명단은 남긴다 */
function ResetCoupon({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ removed: number }>('POST', '/api/admin/coupon/reset', { confirm, password: pw });
      toast(`쿠폰 기록 ${r.removed}건을 초기화했습니다. 다시 배포할 수 있습니다.`);
      setOpen(false); setConfirm(''); setPw(''); onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2 className="h-sec">쿠폰 초기화 (테스트용)</h2>
      <p className="xs muted" style={{ marginTop: 4 }}>지금까지 배포한 쿠폰·당첨자·긁은 기록·수령 기록을 모두 지우고, 모든 사람의 쿠폰을 '잠김' 상태로 되돌립니다. 당첨 제외 명단은 그대로 남습니다.</p>
      <button className="btn btn-danger btn-s" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>쿠폰 초기화…</button>
      {open && (
        <Sheet title="쿠폰 정보 초기화" onClose={() => setOpen(false)} closeDisabled={busy}
          footer={<button className="btn btn-danger btn-block" disabled={busy || confirm !== '초기화' || !pw} onClick={() => void run()}>{busy ? '초기화 중…' : '모든 쿠폰 기록 초기화'}</button>}>
          <div className="warn-card"><b>되돌릴 수 없습니다.</b> 리허설이 끝난 뒤, 실제 쿠폰을 배포하기 <b>전에만</b> 사용하세요.</div>
          <label className="field" style={{ marginTop: 14 }}><span className="label">확인 문구: <b>초기화</b> 라고 입력</span>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-autofocus /></label>
          <label className="field" style={{ marginTop: 12 }}><span className="label">점수 취소 비밀번호</span>
            <input className="input" type="password" inputMode="numeric" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
        </Sheet>
      )}
    </section>
  );
}
