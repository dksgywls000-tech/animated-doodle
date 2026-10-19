import { useState } from 'react';
import { api, errMsg } from '../api';
import { fmtFull, formatTicket, teamLabel } from '../util';

interface Found { ticketNumber: number; name: string; teamNumber: number; role: string; active: boolean; checkedInAt: string; employeeId: string }

/** 행운권 번호로 주인 찾기 — 경품 추첨 때 사용. 조회 기록은 감사 로그에 남는다 */
export function Tickets() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ n: number; issued: number; ticket: Found | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Found[]>([]);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const n = Number(q.trim());
    if (!Number.isInteger(n) || n < 1) { setErr('행운권 번호를 숫자로 입력해 주세요.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api<{ issued: number; ticket: Found | null }>('GET', `/api/admin/tickets/${n}`);
      setResult({ n, ...r });
      if (r.ticket) setHistory((h) => [r.ticket!, ...h.filter((x) => x.ticketNumber !== n)].slice(0, 10));
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="h-title">행운권 조회</h1>
      <p className="xs muted" style={{ marginBottom: 12 }}>번호를 입력하면 그 번호를 받은 사람을 찾습니다. 경품 추첨 때 사용하세요. 조회 기록은 감사 로그에 남습니다.</p>
      <form className="panel row" onSubmit={(e) => void search(e)} style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1 }}>
          <span className="label">행운권 번호</span>
          <input className="input num" inputMode="numeric" pattern="[0-9]*" value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ''))} placeholder="예: 87" style={{ fontSize: 24, fontWeight: 800 }} data-autofocus />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy || !q}>{busy ? '조회 중…' : '조회'}</button>
      </form>
      {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      {result && (
        <div aria-live="polite" style={{ marginTop: 16 }}>
          {result.ticket ? (
            <div className="ticket" style={{ padding: 20 }}>
              <div className="ticket-label">LUCKY TICKET · No.{formatTicket(result.ticket.ticketNumber)}</div>
              <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>{result.ticket.name}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--lime)' }}>{teamLabel(result.ticket.teamNumber)}</div>
              <div className="small" style={{ marginTop: 8, color: 'rgba(255,255,255,.8)' }}>사번 {result.ticket.employeeId} · {fmtFull(result.ticket.checkedInAt)} 입장{!result.ticket.active ? ' · 현재 비활성' : ''}</div>
            </div>
          ) : (
            <div className="warn-card"><b>No.{formatTicket(result.n)}</b>은 아직 아무에게도 발급되지 않았습니다. (현재 {result.issued}장 발급)</div>
          )}
        </div>
      )}
      {history.length > 1 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <h2 className="h-sec">최근 조회</h2>
          {history.map((h) => (
            <div className="list-row" key={h.ticketNumber}><span className="num" style={{ fontWeight: 800 }}>No.{formatTicket(h.ticketNumber)}</span><span>{h.name} · {teamLabel(h.teamNumber)}</span></div>
          ))}
        </section>
      )}
    </div>
  );
}
