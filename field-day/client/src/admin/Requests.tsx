import { api, errMsg } from '../api';
import { useApi } from '../hooks';
import { fmtFull } from '../util';
import { useToast } from '../components/Toast';

const KIND: Record<string, string> = { route: '길 안내', supplies: '물품', other: '기타' };
const HS: Record<string, string> = { open: '접수', in_progress: '확인 중', done: '완료' };

export function Requests() {
  const toast = useToast();
  const help = useApi<{ requests: { id: string; kind: string; body: string; status: string; createdAt: string; name: string; teamNumber: number }[] }>('/api/admin/help', (e) => e.type === 'help_changed');
  const reports = useApi<{ reports: { id: string; reason: string; status: string; createdAt: string; messageId: string; channel: string; body: string; senderName: string; senderTeam: number; hidden: boolean; deleted: boolean; reporterName: string }[] }>('/api/admin/reports', (e) => e.type === 'reports_changed');

  const setHelp = async (id: string, status: string) => { try { await api('PATCH', `/api/admin/help/${id}`, { status }); await help.reload(); } catch (e) { toast(errMsg(e)); } };
  const setReport = async (id: string, status: string) => { try { await api('PATCH', `/api/admin/reports/${id}`, { status }); await reports.reload(); } catch (e) { toast(errMsg(e)); } };
  const hide = async (messageId: string, hidden: boolean) => { try { await api('POST', `/api/admin/chat/messages/${messageId}/hide`, { hidden }); await reports.reload(); toast(hidden ? '메시지를 숨겼습니다' : '숨김을 해제했습니다'); } catch (e) { toast(errMsg(e)); } };

  return (
    <div className="grid-2">
      <section className="panel">
        <h2 className="h-sec">도움 요청</h2>
        <p className="xs muted">참가자는 자신의 요청 상태만 봅니다.</p>
        {help.data?.requests.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>요청이 없습니다.</p>}
        {help.data?.requests.map((r) => (
          <div className="list-row" key={r.id} style={{ alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 700 }}><span className="badge" style={{ marginRight: 6 }}>{KIND[r.kind]}</span>{r.name} · {r.teamNumber}조</div>
              {r.body && <div className="small" style={{ marginTop: 4 }}>{r.body}</div>}
              <div className="xs muted num">{fmtFull(r.createdAt)}</div>
            </div>
            <select className="select" style={{ width: 112, flex: 'none' }} value={r.status} aria-label="처리 상태" onChange={(e) => void setHelp(r.id, e.target.value)}>
              {Object.entries(HS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2 className="h-sec">채팅 신고</h2>
        {reports.data?.reports.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>신고가 없습니다.</p>}
        {reports.data?.reports.map((r) => (
          <div className="list-row" key={r.id} style={{ alignItems: 'flex-start', flexDirection: 'column' }}>
            <div className="between" style={{ width: '100%' }}>
              <span className="small"><b>{r.senderName}</b> · {r.senderTeam}조 · {r.channel === 'all' ? '전체' : r.channel.replace('team:', '') + '조 방'}</span>
              <span className={`badge ${r.status === 'open' ? 'orange' : 'gray'}`}>{r.status === 'open' ? '미처리' : r.status === 'resolved' ? '처리됨' : '기각'}</span>
            </div>
            <div className="card" style={{ width: '100%', padding: 10 }}>{r.deleted ? <i className="muted">작성자가 삭제함</i> : r.body}</div>
            <div className="xs muted">신고 {r.reporterName} · {r.reason || '사유 없음'} · {fmtFull(r.createdAt)}</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-s" onClick={() => void hide(r.messageId, !r.hidden)}>{r.hidden ? '숨김 해제' : '메시지 숨기기'}</button>
              {r.status === 'open' && <button className="btn btn-ghost btn-s" onClick={() => void setReport(r.id, 'resolved')}>처리 완료</button>}
              {r.status === 'open' && <button className="btn btn-plain btn-s" onClick={() => void setReport(r.id, 'dismissed')}>기각</button>}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
