// 데모 HTML에 내장되는 이미지(data URI). 빌드 시 vite ?inline으로 변환된다.
import bus from './img/02_bus_boarding_map.jpg?inline';
import venue from './img/03_venue_access_map.jpg?inline';
import seat from './img/04_team_seating.jpg?inline';
import layout from './img/05_activity_layout.jpg?inline';
import balloon from './img/06_balloon_example.jpg?inline';
import rope from './img/07_jump_rope_example.jpg?inline';
import ball from './img/08_ball_bounce_example.jpg?inline';
import tube from './img/09_tube_relay_example.jpg?inline';

export const ASSET_MAP: Record<string, string> = {
  '/assets/02_bus_boarding_map.jpg': bus,
  '/assets/03_venue_access_map.jpg': venue,
  '/assets/04_team_seating.jpg': seat,
  '/assets/05_activity_layout.jpg': layout,
  '/assets/06_balloon_example.jpg': balloon,
  '/assets/07_jump_rope_example.jpg': rope,
  '/assets/08_ball_bounce_example.jpg': ball,
  '/assets/09_tube_relay_example.jpg': tube,
};
export const GAME_IMAGES: Record<string, string> = { balloon, jumprope: rope, ballbounce: ball, tuberelay: tube };
