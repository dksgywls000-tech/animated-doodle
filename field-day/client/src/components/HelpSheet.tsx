import { useRef, useState } from 'react';
import { api, errMsg } from '../api';
import { useApi } from '../hooks';
import { fmtTime, uid } from '../util';
import { Sheet } from './Sheet';

const KINDS = [['route', '길 안내'], ['supplies', '물품'], ['other', '기타']] as const;
const STATUS: Record<string, [string, string]> = { open: ['접수됨', 'gray'], in_progress: ['확인 중', 'orange'], done: ['처리 완료', ''] };

export function HelpSheet({ onClose, go }: { onClose: () => void; go: (r: string) => void }) {
  const [kind, setKind] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const reqId = useRef(uid());
  const mine = useApi<{ requests: { id: string; kind: string; body: string; status: string; createdAt: string }[] }>('/api/help');

  const submit = async () => {
    if (!kind || busy) return;
    setBusy(true); setErr(null);
    try {
      await api('POST', '/api/help', { kind, body, clientReqId: reqId.current });
      reqId.current = uid();
      setOk(true); setKind(null); setBody('');
      await mine.reload();
    } catch (e) {
      // 같은 요청 ID로 다시 보내면 서버가 중복 없이 처리한다
      setErr(errMsg(e));
    } finally { setBusy(false); }
  };

  return (
    <Sheet title="운영진에게 도움 요청" onClose={onClose}
      footer={<button className="btn btn-primary btn-block" disabled={!kind || busy || (kind === 'other' && body.trim().length < 2)} onClick={() => void submit()}>{busy ? '보내는 중…' : '요청 보내기'}</button>}>
      <div className="warn-card" style={{ marginBottom: 16 }}>
        <b>다치거나 몸이 안 좋다면</b> 앱으로 기다리지 말고 <b>운영지원·응급보건실</b>로 바로 와 주세요.
        <div style={{ marginTop: 8 }}><button className="btn btn-ghost btn-s" onClick={() => { onClose(); go('/map/support'); }}>운영지원·응급보건실 위치 보기</button></div>
      </div>
      <div className="step-title">무엇이 필요하세요?</div>
      <div className="chips" role="group" aria-label="요청 종류">
        {KINDS.map(([k, l]) => <button key={k} className="chip" aria-pressed={kind === k} onClick={() => { setKind(k); setOk(false); }}>{l}</button>)}
      </div>
      <label className="field" style={{ marginTop: 14 }}>
        <span className="label">내용 {kind === 'other' ? '(필수)' : '(선택)'}</span>
        <textarea className="textarea" value={body} maxLength={300} onChange={(e) => setBody(e.target.value)} placeholder="예: 3조 자리 근처, 물이 부족해요" />
      </label>
      <p className="hint">운영진이 확인하는 대로 처리합니다. 현장 상황에 따라 늦어질 수 있어요.</p>
      {err && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      {ok && <div className="form-ok" role="status" style={{ marginTop: 12 }}>요청을 보냈습니다.</div>}
      {!!mine.data?.requests.length && (
        <>
          <div className="step-title" style={{ marginTop: 24 }}>내 요청</div>
          {mine.data.requests.map((r) => (
            <div className="list-row" key={r.id}>
              <div>
                <div style={{ fontWeight: 700 }}>{KINDS.find(([k]) => k === r.kind)?.[1]}{r.body && <span className="muted"> · {r.body}</span>}</div>
                <div className="xs muted">{fmtTime(r.createdAt)} 요청</div>
              </div>
              <span className={`badge ${STATUS[r.status]?.[1] ?? ''}`}>{STATUS[r.status]?.[0]}</span>
            </div>
          ))}
        </>
      )}
    </Sheet>
  );
}
