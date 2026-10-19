import { useState } from 'react';
import { api, errMsg } from '../api';
import { useApi } from '../hooks';
import { cx, fmtFull, timeRange } from '../util';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { IconCheck, IconPlus } from '../components/Icons';
import type { Announcement, ScheduleItem } from '../types';

const STATUS_LABEL: Record<string, string> = { scheduled: '예정', time_tbd: '시간 확인 중', live: '진행 중', done: '종료', delayed: '지연' };

interface EventSettings { schedulePublished: boolean; parkingPublished: boolean; parkingNote: string; returnBusPublished: boolean; returnBusNote: string; departureNote: string; statusNote: string; statusNoteUpdatedAt: string | null }

export function Ops() {
  return (
    <div>
      <h1 className="h-title">공지·일정 관리</h1>
      <p className="xs muted" style={{ marginBottom: 16 }}>여기서 바꾼 내용은 참가자 화면에 바로 반영됩니다. 점수 정보는 참가자에게 보이지 않습니다.</p>
      <div className="grid-2">
        <div className="stack">
          <Checklist />
          <StatusPanel />
          <Announcements />
          <TransportPanel />
        </div>
        <div className="stack">
          <ScheduleAdmin />
        </div>
      </div>
    </div>
  );
}

function Checklist() {
  const { data } = useApi<{ items: { key: string; label: string; done: boolean; detail: string }[] }>('/api/admin/setup-checklist', (e) => e.type === 'public_changed');
  return (
    <section className="panel">
      <h2 className="h-sec">초기 설정 체크리스트</h2>
      <p className="xs muted">원문 자료의 충돌·미확정 사항입니다. 확정 전에는 참가자에게 ‘확인 중’으로 보입니다.</p>
      {data?.items.map((i) => (
        <div key={i.key} className={cx('check-item', i.done && 'done')}>
          <span className="ck" aria-label={i.done ? '완료' : '미완료'}>{i.done && <IconCheck size={16} />}</span>
          <div><div style={{ fontWeight: 700 }}>{i.label}</div><div className="xs muted">{i.detail}</div></div>
        </div>
      ))}
    </section>
  );
}

function useEventSettings() {
  return useApi<EventSettings>('/api/admin/event', (e) => e.type === 'public_changed' && e.data?.what === 'event');
}

function StatusPanel() {
  const toast = useToast();
  const { data, reload } = useEventSettings();
  const [note, setNote] = useState<string | null>(null);
  const save = async (body: Partial<EventSettings>) => {
    try { await api('PATCH', '/api/admin/event', body); toast('저장했습니다'); setNote(null); await reload(); } catch (e) { toast(errMsg(e)); }
  };
  if (!data) return <div className="skeleton" style={{ height: 160 }} />;
  const v = note ?? data.statusNote;
  return (
    <section className="panel">
      <h2 className="h-sec">진행 상태 안내</h2>
      <label className="field" style={{ marginTop: 10 }}>
        <span className="label">참가자 상단 안내 문구</span>
        <input className="input" value={v} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder="예: 공 튕기기는 14:40에 시작합니다" />
      </label>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-primary btn-s" onClick={() => void save({ statusNote: v })} disabled={note === null}>안내 게시</button>
        {data.statusNote && <button className="btn btn-ghost btn-s" onClick={() => void save({ statusNote: '' })}>안내 내리기</button>}
        {data.statusNoteUpdatedAt && <span className="xs muted">최근 변경 {fmtFull(data.statusNoteUpdatedAt)}</span>}
      </div>
      <label className="check" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={data.schedulePublished} onChange={(e) => void save({ schedulePublished: e.target.checked })} />
        일정 확정 공개 (끄면 참가자에게 ‘초안’ 표시)
      </label>
    </section>
  );
}

function TransportPanel() {
  const toast = useToast();
  const { data, reload } = useEventSettings();
  const [form, setForm] = useState<EventSettings | null>(null);
  if (!data) return null;
  const f = form ?? data;
  const set = (k: keyof EventSettings, v: string | boolean) => setForm({ ...f, [k]: v });
  const save = async () => {
    try {
      await api('PATCH', '/api/admin/event', { departureNote: f.departureNote, parkingNote: f.parkingNote, parkingPublished: f.parkingPublished, returnBusNote: f.returnBusNote, returnBusPublished: f.returnBusPublished });
      toast('교통 안내를 저장했습니다'); setForm(null); await reload();
    } catch (e) { toast(errMsg(e)); }
  };
  return (
    <section className="panel">
      <h2 className="h-sec">교통·주차 안내</h2>
      <label className="field" style={{ marginTop: 10 }}><span className="label">출발 안내</span><textarea className="textarea" value={f.departureNote} maxLength={300} onChange={(e) => set('departureNote', e.target.value)} /></label>
      <label className="field" style={{ marginTop: 10 }}><span className="label">주차 안내 (원문 내용 — 확인 후 공개)</span><textarea className="textarea" value={f.parkingNote} maxLength={300} onChange={(e) => set('parkingNote', e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={f.parkingPublished} onChange={(e) => set('parkingPublished', e.target.checked)} />주차 안내 공개</label>
      <label className="field" style={{ marginTop: 10 }}><span className="label">귀가 버스 안내</span><textarea className="textarea" value={f.returnBusNote} maxLength={300} onChange={(e) => set('returnBusNote', e.target.value)} placeholder="확정된 배차·탑승 위치·출발 시각" /></label>
      <label className="check"><input type="checkbox" checked={f.returnBusPublished} onChange={(e) => set('returnBusPublished', e.target.checked)} />귀가 버스 안내 공개</label>
      <button className="btn btn-primary btn-s" style={{ marginTop: 8 }} disabled={!form} onClick={() => void save()}>저장</button>
    </section>
  );
}

function Announcements() {
  const toast = useToast();
  const { data, reload } = useApi<{ announcements: Announcement[] }>('/api/admin/announcements', (e) => e.type === 'public_changed' && e.data?.what === 'announcements');
  const [edit, setEdit] = useState<Partial<Announcement> | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      const body = { title: edit.title ?? '', body: edit.body ?? '', important: !!edit.important, published: edit.published !== false };
      if (edit.id) await api('PATCH', `/api/admin/announcements/${edit.id}`, body); else await api('POST', '/api/admin/announcements', body);
      toast('공지를 저장했습니다'); setEdit(null); await reload();
    } catch (e) { toast(errMsg(e)); }
  };
  return (
    <section className="panel">
      <div className="between"><h2 className="h-sec">공지</h2><button className="btn btn-primary btn-s" onClick={() => setEdit({ important: false, published: true })}><IconPlus size={18} />새 공지</button></div>
      {data?.announcements.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>공지가 없습니다.</p>}
      {data?.announcements.map((a) => (
        <div className="list-row" key={a.id}>
          <div>
            <div style={{ fontWeight: 700 }}>{a.important && <span className="badge orange" style={{ marginRight: 6 }}>중요</span>}{!a.published && <span className="badge gray" style={{ marginRight: 6 }}>내림</span>}{a.title}</div>
            <div className="xs muted">{fmtFull(a.updatedAt)}</div>
          </div>
          <button className="btn btn-ghost btn-s" onClick={() => setEdit(a)}>수정</button>
        </div>
      ))}
      {edit && (
        <Sheet title={edit.id ? '공지 수정' : '새 공지'} onClose={() => setEdit(null)} footer={<button className="btn btn-primary btn-block" disabled={!edit.title?.trim()} onClick={() => void save()}>저장</button>}>
          <label className="field"><span className="label">제목</span><input className="input" value={edit.title ?? ''} maxLength={80} onChange={(e) => setEdit({ ...edit, title: e.target.value })} data-autofocus /></label>
          <label className="field" style={{ marginTop: 12 }}><span className="label">내용</span><textarea className="textarea" value={edit.body ?? ''} maxLength={1000} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={!!edit.important} onChange={(e) => setEdit({ ...edit, important: e.target.checked })} />중요 공지 (상단 고정)</label>
          <label className="check"><input type="checkbox" checked={edit.published !== false} onChange={(e) => setEdit({ ...edit, published: e.target.checked })} />참가자에게 게시</label>
          <p className="hint">점수·순위는 공지에 쓰지 마세요. 점수는 관리자 화면에서만 관리합니다.</p>
        </Sheet>
      )}
    </section>
  );
}

function ScheduleAdmin() {
  const toast = useToast();
  const { data, reload } = useApi<{ items: ScheduleItem[] }>('/api/admin/schedule', (e) => e.type === 'public_changed' && e.data?.what === 'schedule');
  const [edit, setEdit] = useState<ScheduleItem | null>(null);
  const [adding, setAdding] = useState(false);
  const patch = async (i: ScheduleItem, changes: Partial<ScheduleItem>) => {
    try { await api('PATCH', `/api/admin/schedule/${i.id}`, { ...i, ...changes }); toast('일정을 바꿨습니다'); setEdit(null); await reload(); } catch (e) { toast(errMsg(e)); }
  };
  return (
    <section className="panel">
      <div className="between"><h2 className="h-sec">일정·진행 상태</h2><button className="btn btn-ghost btn-s" onClick={() => setAdding(true)}><IconPlus size={18} />항목 추가</button></div>
      <p className="xs muted">‘진행 중’은 운영진이 직접 지정합니다. 기기 시각으로 자동 확정하지 않습니다.</p>
      {data?.items.map((i) => (
        <div className="list-row" key={i.id} style={{ alignItems: 'flex-start', opacity: i.public ? 1 : 0.55 }}>
          <div style={{ minWidth: 0 }}>
            <div className="xs muted num">{timeRange(i.startTime, i.endTime)}{!i.public && ' · 비공개'}</div>
            <div style={{ fontWeight: 700 }}>{i.title}</div>
            {i.delayNote && <div className="xs" style={{ color: 'var(--orange-text)', fontWeight: 700 }}>{i.delayNote}</div>}
          </div>
          <div className="row" style={{ flex: 'none' }}>
            <select className="select" aria-label={`${i.title} 진행 상태`} value={i.status} onChange={(e) => void patch(i, { status: e.target.value as ScheduleItem['status'] })} style={{ width: 128 }}>
              {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="btn btn-ghost btn-s" onClick={() => setEdit(i)}>수정</button>
          </div>
        </div>
      ))}
      {edit && <ScheduleEdit item={edit} onClose={() => setEdit(null)} onSave={(c) => void patch(edit, c)} />}
      {adding && <ScheduleEdit item={null} onClose={() => setAdding(false)} onSave={async (c) => {
        try { await api('POST', '/api/admin/schedule', c); toast('추가했습니다'); setAdding(false); await reload(); } catch (e) { toast(errMsg(e)); }
      }} />}
    </section>
  );
}

function ScheduleEdit({ item, onClose, onSave }: { item: ScheduleItem | null; onClose: () => void; onSave: (c: Partial<ScheduleItem>) => void }) {
  const [f, setF] = useState({ title: item?.title ?? '', note: item?.note ?? '', startTime: item?.startTime ?? '', endTime: item?.endTime ?? '', delayNote: item?.delayNote ?? '', public: item?.public ?? true });
  return (
    <Sheet title={item ? '일정 수정' : '일정 추가'} onClose={onClose} footer={<button className="btn btn-primary btn-block" disabled={!f.title.trim()} onClick={() => onSave({ ...f, startTime: f.startTime || null, endTime: f.endTime || null })}>저장</button>}>
      <label className="field"><span className="label">제목</span><input className="input" value={f.title} maxLength={60} onChange={(e) => setF({ ...f, title: e.target.value })} data-autofocus /></label>
      <div className="row" style={{ marginTop: 12 }}>
        <label className="field" style={{ flex: 1 }}><span className="label">시작</span><input className="input num" type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></label>
        <label className="field" style={{ flex: 1 }}><span className="label">종료</span><input className="input num" type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></label>
      </div>
      <label className="field" style={{ marginTop: 12 }}><span className="label">설명</span><input className="input" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      <label className="field" style={{ marginTop: 12 }}><span className="label">지연·변경 안내</span><input className="input" value={f.delayNote} maxLength={120} placeholder="예: 10분 늦게 시작합니다" onChange={(e) => setF({ ...f, delayNote: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={f.public} onChange={(e) => setF({ ...f, public: e.target.checked })} />참가자에게 공개</label>
    </Sheet>
  );
}
