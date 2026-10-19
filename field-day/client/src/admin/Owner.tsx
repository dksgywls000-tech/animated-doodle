import { useState } from 'react';
import { api, ApiError, errMsg } from '../api';
import { useApi } from '../hooks';
import { useMe } from '../session';
import { fmtFull, teamLabel } from '../util';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';

interface Preview {
  inserts: number; updates: { line: number; name: string; teamNumber: number; changes: string[] }[];
  roleChanges: { line: number; name: string; from: string; to: string }[]; unchanged: number; untouchedExisting: number;
  errors: { line: number; reason: string }[]; sample: { line: number; name: string; teamNumber: number; role: string; active: boolean }[];
}
interface Person { id: string; name: string; employeeId: string; teamNumber: number; role: string; active: boolean; checkedInAt: string | null }

const ROLE: Record<string, string> = { participant: '참가자', admin: '관리자', owner: 'owner' };

/** Excel 기본 CSV(CP949)와 UTF-8(BOM 포함)을 모두 읽는다 */
async function readCsv(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('euc-kr').decode(buf); }
}

export function Owner() {
  return (
    <div>
      <h1 className="h-title">명단·권한 (owner)</h1>
      <p className="xs muted" style={{ marginBottom: 16 }}>명단과 관리자 권한 변경은 모두 감사 기록에 남습니다. 행운권·점수 기록은 명단 재업로드로 초기화되지 않습니다.</p>
      <div className="grid-2">
        <div className="stack"><RosterUpload /><ResetTickets /><Exports /></div>
        <div className="stack"><People /><Audit /></div>
      </div>
    </div>
  );
}

function RosterUpload() {
  const toast = useToast();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmRoles, setConfirmRoles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(null); setPreview(null); setConfirmRoles(false);
    const text = await readCsv(f);
    setCsv(text); setFileName(f.name);
    setBusy(true);
    try { setPreview(await api<Preview>('POST', '/api/owner/roster/preview', { csv: text })); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!csv) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ inserted: number; updated: number; unchanged: number }>('POST', '/api/owner/roster/commit', { csv, confirmRoleChanges: confirmRoles });
      toast(`명단 반영: 추가 ${r.inserted} · 갱신 ${r.updated}`);
      setCsv(null); setPreview(null); setFileName('');
    } catch (e) { setErr(e instanceof ApiError ? e.message : errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <section className="panel">
      <h2 className="h-sec">명단 CSV 업로드</h2>
      <p className="xs muted" style={{ marginTop: 4 }}>열: <code>employee_id,name,team_number,role,active</code> · 사번 기준 병합 · 파일에 없는 기존 사람은 그대로 유지 · 비활성화는 active=false로 명시</p>
      <label className="btn btn-ghost btn-s" style={{ marginTop: 10 }}>
        CSV 파일 선택<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {fileName && <span className="small muted" style={{ marginLeft: 8 }}>{fileName}</span>}
      {busy && <p className="small muted">확인 중…</p>}
      {err && <div className="form-error" role="alert" style={{ marginTop: 10 }}>{err}</div>}
      {preview && (
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="badge">추가 {preview.inserts}</span><span className="badge">갱신 {preview.updates.length}</span>
            <span className="badge gray">변경 없음 {preview.unchanged}</span><span className="badge gray">파일에 없는 기존 {preview.untouchedExisting}</span>
            {preview.errors.length > 0 && <span className="badge danger">오류 {preview.errors.length}</span>}
          </div>
          {preview.errors.length > 0 && (
            <div className="form-error" style={{ marginTop: 10, display: 'block' }}>
              오류가 있어 반영할 수 없습니다. 파일을 고친 뒤 다시 올려 주세요.
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontWeight: 500 }}>{preview.errors.slice(0, 30).map((e, i) => <li key={i}>{e.line ? `${e.line}행: ` : ''}{e.reason}</li>)}</ul>
            </div>
          )}
          {preview.updates.length > 0 && <details style={{ marginTop: 10 }}><summary className="small" style={{ fontWeight: 700 }}>갱신 내용 보기</summary><ul className="small">{preview.updates.map((u) => <li key={u.line}>{u.line}행 {u.name}: {u.changes.join(', ')}</li>)}</ul></details>}
          {preview.roleChanges.length > 0 && (
            <div className="warn-card" style={{ marginTop: 10 }}>
              <b>역할 변경 {preview.roleChanges.length}건</b>
              <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{preview.roleChanges.map((r) => <li key={r.line}>{r.name}: {ROLE[r.from]} → {ROLE[r.to]}</li>)}</ul>
              <label className="check"><input type="checkbox" checked={confirmRoles} onChange={(e) => setConfirmRoles(e.target.checked)} />역할 변경 내용을 확인했습니다</label>
            </div>
          )}
          <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} disabled={busy || preview.errors.length > 0 || (preview.roleChanges.length > 0 && !confirmRoles) || (!preview.inserts && !preview.updates.length)} onClick={() => void commit()}>
            명단 반영
          </button>
        </div>
      )}
    </section>
  );
}

function People() {
  const { me } = useMe();
  const toast = useToast();
  const { data, reload } = useApi<{ people: Person[] }>('/api/admin/checkins');
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<{ p: Person; mode: 'role' | 'team' } | null>(null);
  const [role, setRole] = useState('participant');
  const [team, setTeam] = useState(1);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const staff = data?.people.filter((p) => p.role !== 'participant') ?? [];
  const found = q.trim() ? (data?.people ?? []).filter((p) => p.name.includes(q.trim()) || p.employeeId.includes(q.trim())).slice(0, 20) : [];
  const open = (p: Person, mode: 'role' | 'team') => { setTarget({ p, mode }); setRole(p.role); setTeam(p.teamNumber); setReason(''); setErr(null); };
  const save = async () => {
    if (!target) return;
    setErr(null);
    try {
      if (target.mode === 'role') await api('POST', `/api/owner/participants/${target.p.id}/role`, { role });
      else await api('POST', `/api/owner/participants/${target.p.id}/team`, { teamNumber: team, reason });
      toast('변경했습니다. 해당 사용자의 화면에도 바로 반영됩니다.'); setTarget(null); await reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  const row = (p: Person) => (
    <div className="list-row" key={p.id}>
      <div><div style={{ fontWeight: 700 }}>{p.name} <span className="xs muted">· {teamLabel(p.teamNumber)} · {p.employeeId}</span></div><div className="xs muted">{ROLE[p.role]}{p.checkedInAt ? ' · 체크인함' : ''}{!p.active ? ' · 비활성' : ''}</div></div>
      {p.id !== me.id ? (
        <div className="row"><button className="btn btn-ghost btn-s" onClick={() => open(p, 'role')}>권한</button><button className="btn btn-ghost btn-s" onClick={() => open(p, 'team')}>조 변경</button></div>
      ) : <span className="xs muted">본인</span>}
    </div>
  );
  return (
    <section className="panel">
      <h2 className="h-sec">관리자 지정·조 예외 변경</h2>
      <input className="input" style={{ marginTop: 10, minHeight: 44 }} placeholder="이름 또는 사번 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="참가자 검색" />
      {found.map(row)}
      <div className="step-title">현재 운영진 ({staff.length})</div>
      {staff.map(row)}
      {target && (
        <Sheet title={target.mode === 'role' ? `${target.p.name} 권한 변경` : `${target.p.name} 조 예외 변경`} onClose={() => setTarget(null)}
          footer={<button className="btn btn-primary btn-block" onClick={() => void save()} disabled={target.mode === 'team' && (reason.trim().length < 2 || team === target.p.teamNumber)}>변경</button>}>
          {target.mode === 'role' ? (
            <div className="chips" role="radiogroup" aria-label="역할">{Object.entries(ROLE).map(([k, l]) => <button key={k} role="radio" aria-checked={role === k} className="chip" aria-pressed={role === k} onClick={() => setRole(k)}>{l}</button>)}</div>
          ) : (
            <>
              <p className="small">현재 {teamLabel(target.p.teamNumber)} {target.p.checkedInAt ? '· 이미 체크인함 (예외 변경)' : ''}</p>
              <div className="team-grid" style={{ marginTop: 10 }}>{[1, 2, 3, 4, 5, 6, 7, 8, 0].map((t) => <button key={t} className="opt num" aria-pressed={team === t} onClick={() => setTeam(t)}>{teamLabel(t)}</button>)}</div>
              <label className="field" style={{ marginTop: 12 }}><span className="label">변경 사유 (감사 기록)</span><input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></label>
              <p className="hint">변경 즉시 이전 조 채팅 접근이 끊기고 새 조 채팅으로 바뀝니다. 행운권 번호는 그대로입니다.</p>
            </>
          )}
          {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
        </Sheet>
      )}
    </section>
  );
}

function Exports() {
  return (
    <section className="panel">
      <h2 className="h-sec">내보내기·백업</h2>
      <p className="xs muted">개인정보가 포함됩니다. 행사 종료 후 운영 정책에 따라 삭제해 주세요.</p>
      <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <a className="btn btn-ghost btn-s" href="/api/owner/export/checkins.csv" download>명단·체크인·행운권 CSV</a>
        <a className="btn btn-ghost btn-s" href="/api/admin/scores/export.csv" download>점수 기록 CSV</a>
        <a className="btn btn-ghost btn-s" href="/api/owner/export/audit.csv" download>감사 기록 CSV</a>
      </div>
    </section>
  );
}

const ACTION: Record<string, string> = {
  roster_import: '명단 업로드', role_change: '권한 변경', team_change: '조 예외 변경', admin_view_team_chat: '타 조 채팅 열람',
  chat_hide: '채팅 숨김', chat_unhide: '채팅 숨김 해제', schedule_update: '일정 변경', event_info_update: '안내 변경',
  export_scores: '점수 내보내기', export_checkins: '명단 내보내기', export_audit: '감사 내보내기', event_initialized: '행사 초기화',
  bootstrap_owner: 'owner 지정(서버)', add_owner: 'owner 추가(CLI)',
};

function Audit() {
  const { data } = useApi<{ events: { id: number; actorName: string | null; action: string; target: string | null; detail: any; createdAt: string }[] }>('/api/owner/audit');
  return (
    <section className="panel">
      <h2 className="h-sec">감사 기록</h2>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {data?.events.map((e) => (
          <div className="list-row" key={e.id} style={{ alignItems: 'flex-start' }}>
            <div className="small"><b>{ACTION[e.action] ?? e.action}</b> · {e.actorName ?? '시스템'}
              {e.detail && Object.keys(e.detail).length > 0 && <div className="xs muted" style={{ wordBreak: 'break-all' }}>{JSON.stringify(e.detail)}</div>}
            </div>
            <span className="xs muted num" style={{ flex: 'none' }}>{fmtFull(e.createdAt)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 테스트용: 행운권 정보 전체 초기화 (owner) */
function ResetTickets() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ removed: number }>('POST', '/api/owner/tickets/reset', { confirm, password: pw });
      toast(`행운권 ${r.removed}장을 초기화했습니다. 다음 입장자부터 새 번호를 받습니다.`);
      setOpen(false); setConfirm(''); setPw('');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section className="panel">
      <h2 className="h-sec">행운권 초기화 (테스트용)</h2>
      <p className="xs muted" style={{ marginTop: 4 }}>모든 사람의 행운권 번호·입장 기록을 지우고 1~300을 새로 섞습니다. 점수·채팅·명단은 그대로입니다. 이미 접속해 있는 사람은 앱을 다시 열면 새 번호를 받습니다.</p>
      <button className="btn btn-danger btn-s" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>행운권 초기화…</button>
      {open && (
        <Sheet title="행운권 정보 초기화" onClose={() => setOpen(false)} closeDisabled={busy}
          footer={<button className="btn btn-danger btn-block" disabled={busy || confirm !== '초기화' || !pw} onClick={() => void run()}>{busy ? '초기화 중…' : '모든 행운권 초기화'}</button>}>
          <div className="warn-card"><b>되돌릴 수 없습니다.</b> 리허설이 끝난 뒤, 실제 입장이 시작되기 <b>전에만</b> 사용하세요. 누군가 입장하는 중에 실행하면 번호가 어긋날 수 있습니다.</div>
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
