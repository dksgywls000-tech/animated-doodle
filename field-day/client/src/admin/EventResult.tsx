import { useState } from 'react';
import { api, errMsg } from '../api';
import { teamLabel } from '../util';

interface Row { id: string; employeeId: string; name: string; teamNumber: number; role: string; active: boolean; attended: boolean; firstAt: string | null; ticket: number | null; drawnAt: string | null; couponWin: boolean; couponClaimed: boolean }
interface Result {
  rows: Row[];
  resets: { at: string; action: string; actor: string; detail: unknown }[];
  unmatched: { n: number; at: string }[];
  counts: { checkins: number; bindings: number; lookups: number; coupons: number; audit: number };
}
const RESET_LABEL: Record<string, string> = { reset_all: '전체 초기화', tickets_reset: '행운권 초기화', coupon_reset: '쿠폰 초기화' };

const kst = (iso: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '');
function download(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => { const t = String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const text = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 행사 결과 받기 — 참가/불참, 행운권 추첨(조회) 기록, 쿠폰 당첨을 한 번에 모아 CSV로 */
export function EventResult() {
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = async () => {
    setBusy(true); setErr(null);
    try { setData(await api<Result>('GET', '/api/owner/result')); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const rows = data?.rows.filter((r) => r.active) ?? [];
  const yes = rows.filter((r) => r.attended);
  const drawn = rows.filter((r) => r.drawnAt).sort((a, b) => a.drawnAt!.localeCompare(b.drawnAt!));
  const coupon = rows.filter((r) => r.couponWin);

  const all = () => download('행사결과_전체명단.csv',
    ['사번', '이름', '조', '역할', '참가', '첫 입장시각', '행운권', '행운권 추첨(조회)시각', '쿠폰 당첨', '쿠폰 수령'],
    rows.map((r) => [r.employeeId, r.name, teamLabel(r.teamNumber), r.role, r.attended ? '참가' : '불참', kst(r.firstAt), r.ticket ?? '', kst(r.drawnAt), r.couponWin ? '당첨' : '', r.couponClaimed ? '수령' : '']));
  const lucky = () => download('행사결과_행운권추첨.csv',
    ['조회 순서', '조회시각', '행운권', '이름', '조', '사번'],
    [...drawn.map((r, i) => [i + 1, kst(r.drawnAt), r.ticket ?? '', r.name, teamLabel(r.teamNumber), r.employeeId] as (string | number)[]),
     ...(data?.unmatched ?? []).map((u) => ['-', kst(u.at), u.n, '(주인 기록 없음)', '', ''] as (string | number)[])]);

  return (
    <section className="panel">
      <h2 className="h-sec">행사 결과 받기</h2>
      <p className="xs muted" style={{ marginTop: 4 }}>참가·불참, 행운권 추첨 때 <b>행운권 탭에서 조회한 번호</b>, 스크래치 쿠폰 당첨·수령을 모아 CSV로 받습니다. 읽기만 하며 아무것도 바꾸지 않습니다.</p>
      <button className="btn btn-primary btn-s" style={{ marginTop: 10 }} disabled={busy} onClick={() => void load()}>{busy ? '모으는 중…' : '결과 불러오기'}</button>
      {err && <div className="form-error" role="alert" style={{ marginTop: 10 }}>{err}</div>}
      {data && (
        <div style={{ marginTop: 12 }}>
          {data.resets.length > 0 && (
            <div className="warn-card" role="alert" style={{ marginBottom: 10 }}>
              <b>초기화 기록이 있습니다</b>
              {data.resets.map((r) => <div key={r.at} className="xs">{kst(r.at)} · {RESET_LABEL[r.action] ?? r.action} · {r.actor}</div>)}
              <div className="xs" style={{ marginTop: 4 }}>초기화 뒤 지워진 행운권 번호는 되살릴 수 없습니다. 참가 여부는 접속 기록으로 최대한 채웠습니다.</div>
            </div>
          )}
          <p className="small"><b>참가 {yes.length}명</b> · 불참 {rows.length - yes.length}명 (활성 명단 {rows.length}명)</p>
          <div className="checkin-strip" style={{ marginTop: 8 }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 0].map((t) => {
              const m = rows.filter((r) => r.teamNumber === t); const n = m.filter((r) => r.attended).length;
              return <div className="c" key={t}><div className="xs muted">{teamLabel(t)}</div><b className="num">{n}</b><span className="xs muted num">/{m.length}</span></div>;
            })}
          </div>
          <p className="small" style={{ marginTop: 10 }}>행운권 조회 {drawn.length + data.unmatched.length}건 · 스크래치 쿠폰 당첨 {coupon.length}명(수령 {coupon.filter((r) => r.couponClaimed).length})</p>
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-s" onClick={all}>전체 명단 CSV (참가·불참·당첨)</button>
            <button className="btn btn-ghost btn-s" onClick={lucky}>행운권 추첨 CSV</button>
          </div>
          <p className="xs muted" style={{ marginTop: 8 }}>
            ※ 행운권 '당첨'은 앱이 따로 기록하지 않아, 행운권 탭에서 번호를 조회한 기록으로 대신합니다. 테스트로 조회한 번호도 섞여 있을 수 있으니 조회시각을 확인하세요(추첨은 16:45 무렵).
            · 남아 있는 기록: 입장 {data.counts.checkins} · 접속 {data.counts.bindings} · 조회 {data.counts.lookups} · 쿠폰 {data.counts.coupons} · 감사 {data.counts.audit}건
          </p>
          {drawn.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {drawn.slice(0, 40).map((r) => <div className="list-row" key={r.id}><span className="num">{kst(r.drawnAt).slice(11)} · No.{r.ticket}</span><span>{r.name} · {teamLabel(r.teamNumber)}</span></div>)}
              {drawn.length > 40 && <p className="xs muted">… 전체는 CSV로 확인하세요.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
