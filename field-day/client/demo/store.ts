/**
 * 브라우저 전용 데모 백엔드의 상태 저장소.
 * - 데이터는 이 브라우저의 localStorage에만 저장된다 (다른 기기와 공유되지 않음)
 * - 로그인 상태는 탭별(sessionStorage)이라 탭 두 개로 관리자·참가자를 동시에 볼 수 있다
 * - 실제 운영용이 아니다. 실제 앱은 서버가 권한·동시성을 보장한다.
 */
import { CATEGORIES, EVENT_SUBTYPES, GAMES, SCHEDULE, SEAT_NOTES, RETURN_BUS_NOTE } from '../../server/services/seedData';

const KEY = 'fd-demo-v2';
const SESSION_KEY = 'fd-demo-session';
export const CANCEL_PASSWORD = '1234';

export type Role = 'participant' | 'admin' | 'owner';
export interface P { id: string; employeeId: string; name: string; teamNumber: number; role: Role; active: boolean }
export interface Checkin { participantId: string; seq: number; ticket: number; at: string }
export interface Award { id: string; teamNumber: number; categoryKey: string; subtypeKey: string | null; points: number; reason: string; actorId: string; actorName: string; key: string; createdAt: string }
export interface Reversal { id: string; awardId: string; points: number; reason: string; actorId: string; actorName: string; key: string; createdAt: string }
export interface Msg { id: string; channel: string; senderId: string; senderName: string; senderTeam: number; staff: boolean; body: string; clientMsgId: string; createdAt: string; deletedAt: string | null; hiddenAt: string | null }
export interface Ann { id: string; title: string; body: string; important: boolean; published: boolean; createdAt: string; updatedAt: string; reads: string[] }
export interface Item { id: string; sortOrder: number; startTime: string | null; endTime: string | null; title: string; note: string; kind: string; gameKey: string | null; status: string; delayNote: string; public: boolean; updatedAt: string }
export interface GameRow { key: string; number: number; title: string; players: string; summary: string; howTo: string; bracket: { label: string; a: number; b: number }[]; bracketNote: string; image: string | null; pendingNote: string; published: boolean; updatedAt: string }
export interface Help { id: string; requesterId: string; kind: string; body: string; status: string; clientReqId: string; createdAt: string; updatedAt: string }
export interface Report { id: string; messageId: string; reporterId: string; reason: string; status: string; createdAt: string }

export interface State {
  v: 1;
  participants: P[];
  pool: number[];
  nextSeq: number;
  checkins: Checkin[];
  awards: Award[];
  reversals: Reversal[];
  messages: Msg[];
  reads: Record<string, string>; // `${pid}|${channel}` → ISO
  announcements: Ann[];
  schedule: Item[];
  games: GameRow[];
  event: { schedulePublished: boolean; parkingPublished: boolean; parkingNote: string; returnBusPublished: boolean; returnBusNote: string; departureNote: string; statusNote: string; statusNoteUpdatedAt: string | null; updatedAt: string };
  help: Help[];
  reports: Report[];
  audit: { id: number; actorName: string | null; action: string; target: string | null; detail: unknown; createdAt: string }[];
  /** 쿠폰 당첨 제외(관리자만 앎) */
  couponExclude?: string[];
  /** 스크래치 쿠폰(배포 시 당첨자를 미리 뽑아 둔다) */
  coupon?: { active: boolean; id: string; title: string; winners: number; eligible: number; deployedAt: string; entries: { pid: string; win: boolean; scratchedAt: string | null; claimedAt: string | null }[] } | null;
  /** 데모 전용: 'real'이면 실제 시각, 아니면 행사 당일의 HH:MM으로 가정 */
  clock: string;
}

export const CATS = CATEGORIES.map(([key, label, kind]) => ({ key, label, kind }));
export const SUBS = EVENT_SUBTYPES.map(([key, label]) => ({ key, label }));
export { SEAT_NOTES };

export const rid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function shuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const r = new Uint32Array(1); crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ROSTER: [string, string, number, Role][] = [
  ['TEST-0001', '테스트총괄', 1, 'owner'],
  ['TEST-0002', '테스트관리자', 2, 'admin'],
  ['TEST-0003', '테스트참가자 가', 1, 'participant'],
  ['TEST-0004', '테스트참가자 나', 2, 'participant'],
  ['TEST-0005', '테스트참가자 다', 3, 'participant'],
  ['TEST-0006', '테스트참가자 라', 4, 'participant'],
  ['TEST-0007', '테스트참가자 마', 5, 'participant'],
  ['TEST-0008', '테스트참가자 바', 6, 'participant'],
  ['TEST-0009', '테스트참가자 사', 7, 'participant'],
  ['TEST-0010', '테스트참가자 아', 8, 'participant'],
];

export function seed(images: Record<string, string>): State {
  const t = now();
  const msgs: Msg[] = [
    { channel: 'all', team: 3, name: '테스트참가자 다', body: '오늘 날씨 좋네요! 다들 조끼 받으셨나요?' },
    { channel: 'all', team: 2, name: '테스트관리자', body: '조끼는 조별 자리에서 받으시면 됩니다 🙂', staff: true },
    { channel: 'team:3', team: 3, name: '테스트참가자 다', body: '3조 줄넘기 선수 12명 모여 주세요' },
  ].map((m, i) => ({
    id: rid(), channel: m.channel, senderId: 'seed-' + i, senderName: m.name, senderTeam: m.team, staff: !!m.staff, body: m.body,
    clientMsgId: 'seed' + i, createdAt: new Date(Date.now() - (10 - i) * 60_000).toISOString(), deletedAt: null, hiddenAt: null,
  }));
  return {
    v: 1,
    participants: ROSTER.map(([employeeId, name, teamNumber, role]) => ({ id: rid(), employeeId, name, teamNumber, role, active: true })),
    pool: shuffle(300),
    nextSeq: 1,
    checkins: [],
    awards: [],
    reversals: [],
    messages: msgs,
    reads: {},
    announcements: [
      { id: rid(), title: '[데모] 조끼는 도착 후 조별 자리에서 받으세요', body: '데모용 공지입니다. 실제 공지는 운영진이 관리자 화면에서 작성합니다.', important: true, published: true, createdAt: t, updatedAt: t, reads: [] },
      { id: rid(), title: '[데모] 그늘 공간 이동 가능', body: '좌석 지도 왼쪽 그늘 공간으로 이동할 수 있습니다.', important: false, published: true, createdAt: t, updatedAt: t, reads: [] },
    ],
    schedule: SCHEDULE.map(([startTime, endTime, title, note, kind, gameKey, status], i) => ({
      id: rid(), sortOrder: (i + 1) * 10, startTime, endTime, title, note, kind, gameKey, status, delayNote: '', public: true, updatedAt: t,
    })),
    games: GAMES.map((g) => ({
      key: g.key, number: g.number, title: g.title, players: g.players, summary: g.summary, howTo: g.how_to, bracket: g.bracket,
      bracketNote: g.bracket_note, image: images[g.key] ?? null, pendingNote: g.pending_note, published: true, updatedAt: t,
    })),
    event: {
      schedulePublished: false, parkingPublished: false,
      parkingNote: '자차 이용 시 이충문화체육센터 주차장. 원문 안내: 3시간 무료, 초과 요금은 개인 부담(지원 없음).',
      returnBusPublished: true, returnBusNote: RETURN_BUS_NOTE,
      departureNote: '기존 귀향/퇴근버스 탑승지에서 출발합니다. 버스 4대 2회 운행 예정이며 배차는 별도 안내됩니다.',
      statusNote: '', statusNoteUpdatedAt: null, updatedAt: t,
    },
    help: [],
    reports: [],
    audit: [{ id: 1, actorName: null, action: 'event_initialized', target: null, detail: { ticketPool: 300, demo: true }, createdAt: t }],
    clock: '14:10',
  };
}

let imagesRef: Record<string, string> = {};
export function setImages(i: Record<string, string>) { imagesRef = i; }

export function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s.v === 1) {
        // 이미지 데이터는 파일에 내장 — 저장소에는 넣지 않는다
        s.games.forEach((g) => { g.image = imagesRef[g.key] ?? null; });
        return s;
      }
    }
  } catch { /* 저장소 사용 불가 → 새 상태 */ }
  const s = seed(imagesRef);
  save(s);
  return s;
}

export function save(s: State) {
  try {
    const copy = { ...s, games: s.games.map((g) => ({ ...g, image: null })) };
    localStorage.setItem(KEY, JSON.stringify(copy));
  } catch { /* 저장 실패해도 메모리로 계속 */ }
}

export function reset() {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export const session = {
  get(): string | null { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } },
  set(id: string | null) { try { if (id) sessionStorage.setItem(SESSION_KEY, id); else sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } },
};
