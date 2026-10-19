import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError, errMsg } from '../api';
import { realtime } from '../realtime';
import { useConn } from '../hooks';
import { useMe } from '../session';
import { cx, dayKey, fmtDate, fmtTime, TEAM_COLORS, teamLabel, uid } from '../util';
import { IconSend } from '../components/Icons';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import type { ChatMessage } from '../types';

type Ch = 'all' | 'team';
interface Pending { clientMsgId: string; body: string; status: 'sending' | 'failed'; error?: string; createdAt: string }
const MAX = 500;

export function Chat({ unread, onRead }: { unread: { all: number; team: number }; onRead: (ch: Ch) => void }) {
  const { me } = useMe();
  const toast = useToast();
  const conn = useConn();
  const [ch, setCh] = useState<Ch>('all');
  const [msgs, setMsgs] = useState<Record<Ch, ChatMessage[]>>({ all: [], team: [] });
  const [cursor, setCursor] = useState<Record<Ch, string | null>>({ all: null, team: null });
  const [loaded, setLoaded] = useState<Record<Ch, boolean>>({ all: false, team: false });
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<Ch, Pending[]>>({ all: [], team: [] });
  const [text, setText] = useState('');
  const [reportFor, setReportFor] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const wsCh = (c: Ch) => (c === 'all' ? 'chat:all' : `chat:team:${me.teamNumber}`);

  // 키보드가 열려도 입력창이 가려지지 않도록 visualViewport에 맞춘다
  useEffect(() => {
    const vv = window.visualViewport;
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--vvh', `${h}px`);
      document.documentElement.style.setProperty('--vvt', `${vv ? vv.offsetTop : 0}px`);
      document.body.classList.toggle('kb-open', !!vv && vv.height < window.innerHeight * 0.75);
    };
    apply();
    vv?.addEventListener('resize', apply); vv?.addEventListener('scroll', apply);
    return () => {
      vv?.removeEventListener('resize', apply); vv?.removeEventListener('scroll', apply);
      document.body.classList.remove('kb-open');
    };
  }, []);

  const markRead = useCallback(async (c: Ch) => {
    onRead(c);
    try { await api('POST', `/api/chat/${c}/read`); } catch { /* 다음 기회 */ }
  }, [onRead]);

  const load = useCallback(async (c: Ch, before?: string) => {
    try {
      const r = await api<{ messages: ChatMessage[]; nextCursor: string | null }>('GET', `/api/chat/${c}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      setMsgs((m) => ({ ...m, [c]: merge(before ? [...r.messages, ...m[c]] : [...m[c], ...r.messages]) }));
      if (!before || r.nextCursor === null) setCursor((x) => ({ ...x, [c]: r.nextCursor }));
      else setCursor((x) => ({ ...x, [c]: r.nextCursor }));
      setLoaded((l) => ({ ...l, [c]: true }));
      setLoadErr(null);
    } catch (e) { setLoadErr(errMsg(e)); }
  }, []);

  useEffect(() => { if (!loaded[ch]) void load(ch); void markRead(ch); stick.current = true; }, [ch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => realtime.on((ev) => {
    if (ev.type === 'reconnected') { void load('all'); void load('team'); return; }
    if (ev.type !== 'chat_message' && ev.type !== 'chat_update') return;
    const c: Ch | null = ev.channel === 'chat:all' ? 'all' : ev.channel === `chat:team:${me.teamNumber}` ? 'team' : null;
    if (!c) return;
    const m = ev.data as ChatMessage;
    setMsgs((s) => ({ ...s, [c]: ev.type === 'chat_update' ? s[c].map((x) => (x.id === m.id ? { ...x, ...m, clientMsgId: x.clientMsgId } : x)) : merge([...s[c], m]) }));
    if (ev.type === 'chat_message' && c === ch && m.senderId !== me.id) void markRead(c);
  }), [ch, me.id, me.teamNumber, load, markRead]);

  // 맨 아래에 있을 때만 자동 스크롤
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, pending, ch]);
  const onScroll = () => {
    const el = listRef.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const sendOne = async (c: Ch, p: Pending) => {
    setPending((s) => ({ ...s, [c]: s[c].map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, status: 'sending', error: undefined } : x)) }));
    try {
      const r = await api<{ message: ChatMessage }>('POST', `/api/chat/${c}/messages`, { body: p.body, clientMsgId: p.clientMsgId });
      setMsgs((s) => ({ ...s, [c]: merge([...s[c], r.message]) }));
      setPending((s) => ({ ...s, [c]: s[c].filter((x) => x.clientMsgId !== p.clientMsgId) }));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : errMsg(e);
      // 형식 오류는 재전송해도 안 되므로 입력창으로 되돌린다
      if (e instanceof ApiError && e.status === 400) {
        setPending((s) => ({ ...s, [c]: s[c].filter((x) => x.clientMsgId !== p.clientMsgId) }));
        setText(p.body); toast(msg); return;
      }
      setPending((s) => ({ ...s, [c]: s[c].map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, status: 'failed', error: msg } : x)) }));
    }
  };

  const submit = () => {
    const body = text.trim();
    if (!body || body.length > MAX) return;
    const p: Pending = { clientMsgId: uid(), body, status: 'sending', createdAt: new Date().toISOString() };
    setPending((s) => ({ ...s, [ch]: [...s[ch], p] }));
    setText('');
    stick.current = true;
    void sendOne(ch, p);
  };

  const del = async (m: ChatMessage) => {
    if (!confirm('이 메시지를 삭제할까요? ‘삭제된 메시지’로 표시됩니다.')) return;
    try { const r = await api<{ message: ChatMessage }>('DELETE', `/api/chat/messages/${m.id}`); setMsgs((s) => ({ ...s, [ch]: s[ch].map((x) => (x.id === m.id ? r.message : x)) })); }
    catch (e) { toast(errMsg(e)); }
  };
  const hide = async (m: ChatMessage) => {
    try { const r = await api<{ message: ChatMessage }>('POST', `/api/admin/chat/messages/${m.id}/hide`, { hidden: m.state !== 'hidden' }); setMsgs((s) => ({ ...s, [ch]: s[ch].map((x) => (x.id === m.id ? { ...x, ...r.message } : x)) })); toast('처리했습니다.'); }
    catch (e) { toast(errMsg(e)); }
  };

  const list = msgs[ch];
  const pend = pending[ch];
  let lastDay = '';
  return (
    <div className="chat-wrap" style={{ top: 'var(--vvt, 0px)' }}>
      <div className="chat-head">
        <div className="between" style={{ marginBottom: 8 }}>
          <h1 className="h-sec">채팅</h1>
          <span className="xs" style={{ color: conn === 'online' ? 'var(--ok)' : 'var(--orange-text)', fontWeight: 700 }} role="status">
            {conn === 'online' ? '● 실시간 연결됨' : conn === 'connecting' ? '연결 중…' : '연결 끊김 · 재연결 중'}
          </span>
        </div>
        <div className="seg" role="tablist" aria-label="채팅방">
          <button role="tab" aria-selected={ch === 'all'} onClick={() => setCh('all')}>전체 {ch !== 'all' && unread.all > 0 && <span className="count num">{unread.all}</span>}</button>
          <button role="tab" aria-selected={ch === 'team'} onClick={() => setCh('team')}>우리 조 · {me.teamName} {ch !== 'team' && unread.team > 0 && <span className="count num">{unread.team}</span>}</button>
        </div>
      </div>

      <div className="chat-list" ref={listRef} onScroll={onScroll} role="log" aria-live="polite" aria-label={ch === 'all' ? '전체 채팅' : `${me.teamName} 채팅`}>
        <p className="chat-guide">{me.isStaff ? '점수·순위는 채팅에 올리지 말고 관리자 화면에서만 확인해 주세요.' : ch === 'all' ? '모든 참가자가 보는 방입니다. 서로 존중하는 대화 부탁드려요.' : `${me.teamName}만 보는 방입니다.`}</p>
        {cursor[ch] && <div style={{ textAlign: 'center' }}><button className="btn btn-ghost btn-s" onClick={() => { stick.current = false; void load(ch, cursor[ch]!); }}>이전 메시지 더 보기</button></div>}
        {loadErr && <div className="warn-card between" style={{ marginTop: 8 }}><span>{loadErr}</span><button className="btn btn-ghost btn-s" onClick={() => void load(ch)}>다시 시도</button></div>}
        {loaded[ch] && !list.length && !pend.length && <div className="state-box"><h3>아직 대화가 없어요</h3><p className="small">첫 메시지를 남겨 보세요.</p></div>}
        {!loaded[ch] && !loadErr && <div className="skeleton" style={{ height: 160, marginTop: 12 }} />}
        {list.map((m) => {
          const day = dayKey(m.createdAt);
          const sep = day !== lastDay ? (lastDay = day, <div className="day-sep" key={'d' + day}>{fmtDate(m.createdAt)}</div>) : null;
          const mine = m.senderId === me.id;
          return [sep, (
            <div key={m.id} className={cx('msg', mine && 'mine', m.staff && 'staff')}>
              {!mine && (
                <div className="who">
                  <span>{m.senderName}</span>
                  {m.staff ? <span className="badge staff">관리자</span> : null}
                  <span className="team-badge" style={{ ['--team' as string]: TEAM_COLORS[m.senderTeam] }}>{teamLabel(m.senderTeam)}</span>
                </div>
              )}
              <div className="line">
                <div className={cx('bubble', m.state !== 'ok' && 'gone')}>{m.state === 'ok' ? m.body : m.state === 'deleted' ? '삭제된 메시지입니다' : '운영진이 숨긴 메시지입니다'}</div>
                <span className="time num">{fmtTime(m.createdAt)}</span>
              </div>
              {m.state === 'ok' && (
                <div className="msg-actions">
                  {mine ? <button onClick={() => void del(m)}>삭제</button> : <button onClick={() => setReportFor(m)}>신고</button>}
                  {me.isStaff && !mine && <button onClick={() => void hide(m)}>숨기기</button>}
                </div>
              )}
              {m.state === 'hidden' && me.isStaff && <div className="msg-actions"><button onClick={() => void hide(m)}>숨김 해제</button></div>}
            </div>
          )];
        })}
        {pend.map((p) => (
          <div key={p.clientMsgId} className="msg mine">
            <div className="line">
              <div className="bubble" style={{ opacity: p.status === 'sending' ? 0.65 : 1 }}>{p.body}</div>
              <span className={cx('state', p.status === 'failed' && 'fail')}>{p.status === 'sending' ? '전송 중' : '전송 실패'}</span>
            </div>
            {p.status === 'failed' && (
              <div className="msg-actions">
                <button onClick={() => void sendOne(ch, p)}>다시 보내기</button>
                <button onClick={() => setPending((s) => ({ ...s, [ch]: s[ch].filter((x) => x.clientMsgId !== p.clientMsgId) }))}>지우기</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="composer-inner">
          <label className="sr-only" htmlFor="chat-input">메시지 입력</label>
          <textarea id="chat-input" rows={1} value={text} maxLength={MAX + 50} placeholder={ch === 'all' ? '전체에게 메시지 보내기' : `${me.teamName}에게 메시지 보내기`}
            onChange={(e) => { setText(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(120, e.currentTarget.scrollHeight) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); submit(); } }}
            enterKeyHint="send" />
          <button className="send" type="submit" disabled={!text.trim() || text.trim().length > MAX} aria-label="보내기"><IconSend /></button>
        </div>
        {text.length > MAX - 100 && <div className="len num" style={{ color: text.trim().length > MAX ? 'var(--danger)' : undefined }}>{text.trim().length}/{MAX}</div>}
      </form>

      {reportFor && <ReportSheet m={reportFor} onClose={() => setReportFor(null)} />}
    </div>
  );
}

function merge(list: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const m of list) map.set(m.id, { ...map.get(m.id), ...m });
  return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

function ReportSheet({ m, onClose }: { m: ChatMessage; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api('POST', `/api/chat/messages/${m.id}/report`, { reason }); toast('신고를 접수했습니다. 운영진이 확인합니다.'); onClose(); }
    catch (e) { toast(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title="메시지 신고" onClose={onClose} footer={<button className="btn btn-danger btn-block" disabled={busy} onClick={() => void send()}>신고하기</button>}>
      <div className="card" style={{ marginBottom: 12 }}><div className="xs muted">{m.senderName} · {teamLabel(m.senderTeam)}</div><div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div></div>
      <div className="chips" style={{ marginBottom: 10 }}>{['욕설·비방', '도배', '개인정보', '기타'].map((r) => <button key={r} className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}</div>
      <p className="hint">신고 내용은 운영진만 확인합니다.</p>
    </Sheet>
  );
}
