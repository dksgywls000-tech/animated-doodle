// 씬별 핵심 타이밍(프레임, 씬 시작 기준). 비주얼과 효과음이 같은 값을 쓰므로
// 음성 길이가 바뀌어도(직접 녹음 파일 포함) 둘이 함께 따라 움직인다.
import timing from './generated/timing.json';

export type SceneTiming = (typeof timing.scenes)[number];
export type Sfx = 'whoosh' | 'thud' | 'stamp' | 'pop' | 'tick';

export const sceneCues = (s: SceneTiming) => {
  const A = Math.round(s.audioSec * timing.fps); // 음성 길이(프레임)
  const at = (r: number) => Math.round(A * r);
  const b1 = s.beats.length > 1 ? Math.round(s.beats[1] * timing.fps) : at(0.5);
  const seg2 = (r: number) => Math.round(b1 + (A - b1) * r);
  switch (s.key) {
    case 'hook':
      return {stamp: Math.max(at(0.68), 20)};
    case 'compare':
      return {docsIn: 0, highlight: at(0.45)};
    case 'numbers':
      return {wallball: b1, strike: seg2(0.35), roll: seg2(0.55), land: seg2(0.55) + 10};
    case 'wavezone':
      return {lightStart: at(0.08), lightEnd: at(0.85)};
    case 'lunge':
      return {lineStart: at(0.5), oneFoot: at(0.56), bothFeet: at(0.72)};
    case 'sled':
    {
      // 1→4랩은 "네 랩이 아니라"에 맞춰 빠르게, 4에서 잠깐 멈췄다가 5→6
      const lap4 = Math.max(at(0.42), 22);
      const lap6 = Math.max(at(0.92), lap4 + 18);
      const laps = [0, 1, 2, 3].map((i) => Math.round(2 + ((lap4 - 2) * (i + 1)) / 4));
      const hold = lap4 + Math.round((lap6 - lap4) * 0.35);
      laps.push(Math.round(hold + (lap6 - hold) / 2), lap6);
      return {laps0: 2, lap1: laps[0], lap2: laps[1], lap3: laps[2], lap4: laps[3], lap5: laps[4], lap6: laps[5]};
    }
    case 'rest':
      return {sit: at(0.3), card: at(0.62), plus: at(0.85)};
    case 'penalty':
      return {walk: at(0.1), slam: at(0.74)};
    case 'debate':
      return {left: 0, right: at(0.18), brief: b1};
    case 'cta':
      return {press: at(0.42), type: at(0.42) + 6, handle: at(0.7)};
    default:
      return {};
  }
};

export const sceneSfx = (s: SceneTiming, index: number): {frame: number; sfx: Sfx; vol: number}[] => {
  const c = sceneCues(s) as Record<string, number>;
  const list: {frame: number; sfx: Sfx; vol: number}[] = [];
  if (index > 0) list.push({frame: -2, sfx: 'whoosh', vol: 0.35});
  switch (s.key) {
    case 'hook':
      list.push({frame: 0, sfx: 'thud', vol: 0.55}, {frame: c.stamp, sfx: 'stamp', vol: 0.55});
      break;
    case 'compare':
      list.push({frame: c.highlight, sfx: 'pop', vol: 0.25});
      break;
    case 'numbers':
      list.push({frame: 6, sfx: 'pop', vol: 0.3}, {frame: c.strike, sfx: 'tick', vol: 0.3}, {frame: c.land, sfx: 'thud', vol: 0.5});
      break;
    case 'wavezone':
      for (let i = 0; i < 6; i++)
        list.push({frame: Math.round(c.lightStart + ((c.lightEnd - c.lightStart) * i) / 5), sfx: 'tick', vol: 0.25});
      break;
    case 'lunge':
      list.push({frame: c.oneFoot, sfx: 'pop', vol: 0.25}, {frame: c.bothFeet, sfx: 'pop', vol: 0.3});
      break;
    case 'sled':
      for (let i = 1; i <= 6; i++)
        list.push({frame: c[`lap${i}`], sfx: i === 6 ? 'thud' : 'tick', vol: i === 6 ? 0.45 : 0.25});
      break;
    case 'rest':
      list.push({frame: c.card, sfx: 'stamp', vol: 0.4}, {frame: c.plus, sfx: 'pop', vol: 0.3});
      break;
    case 'penalty':
      list.push({frame: c.slam, sfx: 'stamp', vol: 0.6});
      break;
    case 'debate':
      list.push({frame: 4, sfx: 'stamp', vol: 0.35}, {frame: c.right, sfx: 'pop', vol: 0.3});
      break;
    case 'cta':
      list.push({frame: c.press, sfx: 'pop', vol: 0.4});
      break;
  }
  return list;
};
