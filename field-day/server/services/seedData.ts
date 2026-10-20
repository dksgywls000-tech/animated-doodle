// 행사 기본 데이터 — 서버 초기화와 브라우저 데모가 함께 사용 (의존성 없음)

export const CATEGORIES = [
  ['balloon', '1. 풍선기둥', 'main'],
  ['jumprope', '2. 단체줄넘기', 'main'],
  ['ballbounce', '3. 공 튕기기', 'main'],
  ['tuberelay', '4. 튜브릴레이', 'main'],
  ['event', '이벤트 게임', 'event'],
  ['cheer', '응원점수', 'cheer'],
] as const;

export const EVENT_SUBTYPES = [
  ['balloon_pop', '풍선 빨리 터트리기'],
  ['event_jumprope', '이벤트 단체줄넘기'],
  ['jegi', '제기차기'],
  ['event_tube', '이벤트 튜브릴레이'],
  ['other', '기타 이벤트'],
] as const;

// 원문 운영표 중 참가자에게 공개해도 되는 항목만. 담당자 이름·설치 업무는 넣지 않는다.
export type Seed = [start: string | null, end: string | null, title: string, note: string, kind: string, game: string | null, status: string];
export const SCHEDULE: Seed[] = [
  ['12:10', null, '1회차 버스 출발', '공사팀 · 기존 귀향/퇴근버스 탑승지', 'general', null, 'scheduled'],
  ['12:20', '13:10', '도착 · 조끼 수령 · 인원 확인', '분수광장 하차 후 야외공연장까지 도보 이동', 'general', null, 'scheduled'],
  ['12:35', null, '2회차 버스 출발', '지원팀 + 잔여 인원 · 배차는 별도 안내', 'general', null, 'scheduled'],
  ['13:10', '13:40', '개회식 · 준비운동', '식순 안내 · 개회사 · 조별 자리 이동', 'general', null, 'scheduled'],
  ['13:40', '16:00', '조별 체육대회', '메인 경기와 이벤트가 이어서 진행됩니다', 'main', null, 'scheduled'],
  ['16:05', '16:45', '소통 TALK', '조별 음식 지급', 'break', null, 'scheduled'],
  ['16:45', '17:00', '시상식 · 경품추첨', '', 'general', null, 'scheduled'],
  ['17:00', '17:20', '폐회 · 단체사진', '폐회사 후 단체사진, 조별 물품 반납', 'general', null, 'scheduled'],
  ['17:40', null, '퇴근버스 탑승', '이충동 분수공원 앞 출발', 'general', null, 'scheduled'],
];

const tournament = (pairs: [number, number][]) => pairs.map(([a, b], i) => ({ label: `${i + 1}경기`, a, b }));

export const GAMES = [
  {
    key: 'balloon', number: 1, title: '풍선기둥 세우기',
    players: '조 전체 (현장 인원에 따라 조정)',
    summary: '두 조가 연합팀이 되어 풍선을 불고 쌓아 제한시간 안에 기둥을 세웁니다.',
    how_to: '풍선을 불어 기둥 모양으로 쌓습니다.\n제한시간은 진행자가 현장에서 안내합니다.\n종료 시점에 기둥 높이로 순위를 정합니다.\n각 조 안전관리 담당자는 경기에 참여하지 않고 안전을 살핍니다.',
    bracket: [{ label: '연합 A', a: 1, b: 2 }, { label: '연합 B', a: 3, b: 4 }, { label: '연합 C', a: 5, b: 7 }, { label: '연합 D', a: 6, b: 8 }],
    bracket_note: '연합팀 4개가 동시에 경기합니다.',
    image: '/assets/06_balloon_example.jpg',
    pending_note: '높이 측정 방법 등 세부 기준은 현장 진행자 안내를 따릅니다.',
  },
  {
    key: 'jumprope', number: 2, title: '단체줄넘기',
    players: '조별 12명 (점프 10명 + 줄잡이 2명)',
    summary: '토너먼트로 진행합니다. 연습 3분 후 2회 기록, 좋은 기록을 적용합니다.',
    how_to: '연습 3분이 주어집니다.\n조별로 2회 기록하고 더 좋은 기록을 적용합니다.\n이긴 조가 다음 경기로 올라갑니다.',
    bracket: tournament([[5, 6], [3, 8], [1, 2], [4, 7]]),
    bracket_note: '준결승: 1경기 승 vs 2경기 승 / 3경기 승 vs 4경기 승 → 결승',
    image: '/assets/07_jump_rope_example.jpg',
    pending_note: '',
  },
  {
    key: 'ballbounce', number: 3, title: '공 튕기기',
    players: '조별 20명',
    summary: '큰 천을 함께 잡고 대형 공을 튕깁니다. 연습 3분 후 2회 기록, 좋은 기록을 적용합니다.',
    how_to: '연습 3분이 주어집니다.\n조별로 2회 기록하고 더 좋은 기록을 적용합니다.\n이긴 조가 다음 경기로 올라갑니다.',
    bracket: tournament([[3, 5], [2, 8], [1, 6], [4, 7]]),
    bracket_note: '준결승: 1경기 승 vs 2경기 승 / 3경기 승 vs 4경기 승 → 결승',
    image: '/assets/08_ball_bounce_example.jpg',
    pending_note: '세부 동작과 기록 방식은 현장 진행자가 안내합니다.',
  },
  {
    key: 'tuberelay', number: 4, title: '튜브릴레이',
    players: '조별 30명 (편도 10명씩)',
    summary: '연습 없이 바로 토너먼트로 진행합니다.',
    how_to: '연습 없이 바로 경기합니다.\n편도 10명씩 이어서 달립니다.\n이긴 조가 다음 경기로 올라갑니다.',
    bracket: tournament([[2, 7], [1, 3], [4, 8], [5, 6]]),
    bracket_note: '준결승: 1경기 승 vs 2경기 승 / 3경기 승 vs 4경기 승 → 결승',
    image: '/assets/09_tube_relay_example.jpg',
    pending_note: '3·4위 결정 방식은 운영진 확정 전입니다.',
  },
];

export const SEAT_NOTES: Record<number, string> = {
  0: '운영지원 부스 · 응급보건실 옆',
  1: '배치도 왼쪽 아래 · 운영지원 바로 옆',
  2: '배치도 왼쪽 · 1조 위쪽',
  3: '배치도 가운데 왼쪽',
  4: '배치도 가운데',
  5: '배치도 오른쪽 윗줄',
  6: '배치도 오른쪽 윗줄 끝',
  7: '배치도 오른쪽 아랫줄',
  8: '배치도 오른쪽 아랫줄 끝',
};


/** 귀가(퇴근) 버스 기본 안내 — 운영자가 관리자 화면에서 수정 가능 */
export const RETURN_BUS_NOTE = '17:40 이충동 분수공원 앞 출발 · 1호차 아이파크→용이·비전 / 2호차 블루시티→고덕 / 3호차 블루시티→상공회의소 / 4·5호차 블루시티';

/** 조 번호 0 = 운영진(조에 속하지 않는 행사 운영 인원) */
export const STAFF_TEAM = 0;
export const teamLabel = (n: number) => (n === 0 ? '운영진' : `${n}조`);
