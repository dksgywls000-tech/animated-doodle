import React from 'react';
import {interpolate} from 'remotion';
import {Arrow, Card, CheckIcon, clamp, ease, GradText, Kicker, Pill, usePop, XIcon} from './components';
import {C, F} from './theme';

export type SceneProps = {f: number; n: number; c: Record<string, number>};

const abs = (style: React.CSSProperties): React.CSSProperties => ({position: 'absolute', ...style});
const shake = (f: number, at: number, amp = 18, len = 10) => {
  const t = f - at;
  if (t < 0 || t > len) return 0;
  return Math.sin(t * 2.6) * amp * (1 - t / len);
};

// 1. HOOK — 터널 통과 + 슬램 인 + NO REP 도장
export const Hook: React.FC<SceneProps> = ({f, c}) => {
  // 0프레임부터 1줄+자막+터널이 보이고, 2줄이 바로 슬램 인
  const p1 = usePop(f, -8, 420, 20);
  const p2 = usePop(f, 1, 420, 20);
  const st = usePop(f, c.stamp, 500, 14);
  const line = (p: number): React.CSSProperties => ({
    opacity: interpolate(p, [0, 0.3], [0, 1], clamp),
    transform: `scale(${1 + (1 - p) * 0.9})`,
    transformOrigin: 'left center',
  });
  return (
    <>
      <div style={abs({top: 430, left: 80, fontFamily: F.display, fontSize: 178, lineHeight: 0.98, color: '#fff'})}>
        <div style={line(p1)}>DON&apos;T RUN IT</div>
        <div style={line(p2)}>
          <GradText>LIKE HYROX.</GradText>
        </div>
      </div>
      {f >= c.stamp && (
        <div
          style={abs({
            top: 860,
            left: 330,
            padding: '6px 34px 2px',
            border: `10px solid ${C.red}`,
            borderRadius: 18,
            color: C.red,
            fontFamily: F.display,
            fontSize: 150,
            lineHeight: 1,
            background: 'rgba(22,22,22,0.55)',
            boxShadow: `0 0 40px rgba(255,90,79,0.45)`,
            transform: `rotate(-10deg) scale(${2.2 - 1.2 * st})`,
            opacity: interpolate(st, [0, 0.25], [0, 1], clamp),
          })}
        >
          NO REP
        </div>
      )}
    </>
  );
};

// 2. 대조 — 룰북 두 장 + 다른 줄만 형광펜
const DOC_ROWS = {
  hyrox: ['RUN 1KM × 8', '8 STATIONS', 'SLED 50M', 'WALL BALL 100', 'LUNGE · FRONT FOOT', 'PARTNER STANDS'],
  uw: ['RUN 800M × 8', '11 STATIONS', 'SLED 75M', 'WALL BALL 120', 'LUNGE · BOTH FEET', 'NO SITTING'],
};
const Doc: React.FC<{title: string; rows: string[]; hl?: number[]; f: number; hlAt: number; front?: boolean}> = ({
  title,
  rows,
  hl = [],
  f,
  hlAt,
  front,
}) => (
  <div style={{padding: '34px 36px', height: '100%', boxSizing: 'border-box'}}>
    <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 30, letterSpacing: '0.08em', color: front ? C.green : C.sub}}>
      RULEBOOK
    </div>
    <div style={{fontFamily: F.display, fontSize: 52, color: C.text, marginTop: 6, marginBottom: 22, lineHeight: 1.05}}>{title}</div>
    {rows.map((r, i) => {
      const k = hl.indexOf(i);
      const w = k >= 0 ? ease(f, hlAt + k * 4, hlAt + k * 4 + 7) : 0;
      return (
        <div key={i} style={{position: 'relative', height: 68, display: 'flex', alignItems: 'center'}}>
          <div
            style={abs({left: -10, top: 10, height: 50, width: `${w * 104}%`, background: 'rgba(0,214,75,0.42)', borderRadius: 8})}
          />
          <div
            style={{
              position: 'relative',
              fontFamily: F.label,
              fontWeight: 800,
              fontSize: 36,
              letterSpacing: '0.03em',
              color: w > 0.5 ? '#fff' : front ? '#cfcfcf' : C.dim,
            }}
          >
            {r}
          </div>
        </div>
      );
    })}
  </div>
);
export const Compare: React.FC<SceneProps> = ({f, c}) => {
  const l = usePop(f, 0, 240, 20);
  const r = usePop(f, 4, 240, 20);
  return (
    <>
      <Kicker top={340}>Only the differences</Kicker>
      <Card
        style={{left: 80, top: 430, width: 520, height: 620, transform: `translateX(${(l - 1) * 700}px) rotate(-5deg)`}}
      >
        <Doc title="HYROX DOUBLES" rows={DOC_ROWS.hyrox} f={f} hlAt={999} />
      </Card>
      <Card
        active={f > c.highlight}
        style={{left: 470, top: 460, width: 530, height: 620, transform: `translateX(${(1 - r) * 700}px) rotate(4deg)`}}
      >
        <Doc title="URBANWAVE 2026" rows={DOC_ROWS.uw} hl={[0, 1, 2, 3, 4, 5]} f={f} hlAt={c.highlight} front />
      </Card>
    </>
  );
};

// 3. 숫자 — 6.4KM / 11 STATIONS 팝 → 월볼 100 취소선 → 120 롤링
export const Numbers: React.FC<SceneProps> = ({f, c}) => {
  const a = usePop(f, 0, 300, 16);
  const km = usePop(f, 10, 300, 14);
  const st = usePop(f, 22, 300, 14);
  const toTop = ease(f, c.wallball - 4, c.wallball + 6);
  const wb = usePop(f, c.wallball, 260, 18);
  const strike = ease(f, c.strike, c.strike + 6);
  const rollT = interpolate(f, [c.roll, c.land], [0, 1], clamp);
  const n = Math.round(100 + 20 * (1 - Math.pow(1 - rollT, 2)));
  const land = usePop(f, c.land, 500, 12);
  const showNew = f >= c.roll;
  return (
    <>
      {/* 러닝: 처음엔 크게, 월볼 문장이 시작되면 위로 접힘 */}
      <div
        style={abs({
          top: interpolate(toTop, [0, 1], [420, 340]),
          left: 80,
          transform: `scale(${interpolate(toTop, [0, 1], [1, 0.42])})`,
          transformOrigin: 'left top',
          opacity: a,
        })}
      >
        <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 44, letterSpacing: '0.08em', color: C.green}}>RUN</div>
        <div style={{fontFamily: F.display, fontSize: 200, lineHeight: 1, color: '#fff'}}>800M × 8</div>
        <div style={{display: 'flex', gap: 24, marginTop: 30}}>
          <div style={{transform: `scale(${km})`, transformOrigin: 'left center'}}>
            <Pill solid style={{fontSize: 64, padding: '10px 36px'}}>= 6.4KM</Pill>
          </div>
          <div style={{transform: `scale(${st})`, transformOrigin: 'left center'}}>
            <Pill style={{fontSize: 64, padding: '10px 36px'}}>11 STATIONS</Pill>
          </div>
        </div>
      </div>
      {f >= c.wallball - 2 && (
        <div style={abs({top: 560, left: 80, opacity: wb, transform: `translateY(${(1 - wb) * 60}px)`})}>
          <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 48, letterSpacing: '0.08em', color: C.green}}>
            WALL BALL
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 36, marginTop: 4}}>
            <div style={{position: 'relative', fontFamily: F.display, fontSize: 230, lineHeight: 1, color: strike > 0 ? C.dim : '#fff'}}>
              100
              <div
                style={abs({
                  left: -8,
                  top: '52%',
                  height: 18,
                  width: `${strike * 108}%`,
                  background: C.red,
                  borderRadius: 9,
                  transform: 'rotate(-8deg)',
                  transformOrigin: 'left center',
                })}
              />
            </div>
            {showNew && <Arrow size={90} color={C.sub} />}
            {showNew && (
              <div
                style={{
                  fontFamily: F.display,
                  fontSize: 300,
                  lineHeight: 1,
                  transform: `scale(${f >= c.land ? 1.25 - 0.25 * land : 1})`,
                  transformOrigin: 'left center',
                  filter: f >= c.land ? 'drop-shadow(0 0 24px rgba(45,255,124,0.55))' : undefined,
                }}
              >
                <GradText>{n}</GradText>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

// 4. 웨이브존 — 6칸 순차 점등, 02–06 사이 NO RUN
const STATIONS: [string, string][] = [
  ['RUN', '800M'],
  ['ROW', '1,000M'],
  ['DB SNATCH', '40'],
  ['DB WALKING LUNGE', '40M'],
  ['BOX JUMP OVER', '40'],
  ['BURPEE OVER THE WAVE', '40'],
];
export const WaveZone: React.FC<SceneProps> = ({f, c}) => {
  const step = (c.lightEnd - c.lightStart) / 5;
  const top0 = 420;
  const rowH = 96;
  const gap = 18;
  return (
    <>
      <Kicker top={340}>Wave zone · no run between</Kicker>
      {STATIONS.map(([name, amt], i) => {
        const at = c.lightStart + step * i;
        const on = f >= at;
        const p = usePop(f, at, 320, 16);
        const enter = usePop(f, i * 2, 260, 20);
        return (
          <React.Fragment key={i}>
            <Card
              active={on}
              radius={22}
              style={{
                left: 80,
                top: top0 + i * (rowH + gap),
                width: 920,
                height: rowH,
                display: 'flex',
                alignItems: 'center',
                padding: '0 30px',
                gap: 24,
                opacity: enter,
                transform: `translateX(${(1 - enter) * -120}px) scale(${on ? 1 + 0.04 * Math.sin(Math.min(p, 1) * Math.PI) : 1})`,
                background: on ? '#1d2a21' : C.card,
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 56,
                  borderRadius: 14,
                  background: on ? C.green : '#2c2c2c',
                  color: on ? '#0b0b0b' : C.dim,
                  fontFamily: F.display,
                  fontSize: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div
                style={{
                  flex: 1,
                  fontFamily: F.label,
                  fontWeight: 800,
                  fontSize: 42,
                  letterSpacing: '0.03em',
                  color: on ? '#fff' : C.dim,
                  whiteSpace: 'nowrap',
                }}
              >
                {name}
              </div>
              <div style={{fontFamily: F.display, fontSize: 50, color: on ? C.greenBright : C.dim}}>{amt}</div>
            </Card>
            {i >= 2 && (
              <div
                style={abs({
                  top: top0 + i * (rowH + gap) - gap / 2 - 21,
                  left: 560,
                  opacity: interpolate(f, [at - 2, at + 3], [0, 1], clamp),
                  transform: `scale(${0.7 + 0.3 * Math.min(p, 1)})`,
                })}
              >
                <Pill style={{fontSize: 26, padding: '3px 16px', background: '#161616'}} color={C.greenBright}>
                  NO RUN
                </Pill>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};

// 5. 런지 — 발 모으기 + 라인은 두 발 다
const Foot: React.FC<{x: number; y: number; color?: string}> = ({x, y, color = C.green}) => (
  <ellipse cx={x} cy={y} rx={24} ry={40} fill={color} />
);
const Dash: React.FC<{y: number; w: number}> = ({y, w}) => (
  <line x1={30} x2={w - 30} y1={y} y2={y} stroke="#e6e6e6" strokeWidth={5} strokeDasharray="22 14" />
);
export const Lunge: React.FC<SceneProps> = ({f, c}) => {
  // 위: 걸음마다 발 모으기 (왼발 앞으로 → 오른발이 따라와 나란히)
  const cyc = 24;
  const t = (f % cyc) / cyc;
  const stepIdx = Math.floor(f / cyc);
  const base = 200 - stepIdx * 0;
  const lead = interpolate(t, [0, 0.45], [0, -90], clamp);
  const follow = interpolate(t, [0.5, 0.9], [0, -90], clamp);
  const together = t > 0.9 || t < 0.05;
  const panel = usePop(f, c.lineStart, 260, 20);
  const one = ease(f, c.oneFoot - 6, c.oneFoot);
  const both = ease(f, c.bothFeet - 8, c.bothFeet);
  const W = 440;
  return (
    <>
      <Kicker top={340}>DB walking lunge</Kicker>
      <Card style={{left: 80, top: 420, width: 920, height: 300, overflow: 'hidden'}}>
        <svg width={920} height={300} style={{position: 'absolute', left: 0, top: 0}}>
          <Foot x={160} y={base + lead + 10} />
          <Foot x={220} y={base + follow + 10} color={together ? C.greenBright : '#18a548'} />
        </svg>
        <div style={abs({left: 340, top: 60})}>
          <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 34, letterSpacing: '0.08em', color: C.sub}}>EVERY STEP</div>
          <div style={{fontFamily: F.display, fontSize: 92, lineHeight: 1.05, color: together ? C.greenBright : '#fff'}}>
            FEET TOGETHER
          </div>
          <div style={{fontFamily: F.kr, fontWeight: 700, fontSize: 32, color: C.sub, marginTop: 6}}>상단에서 완전히 서기</div>
        </div>
      </Card>
      {f >= c.lineStart - 1 && (
        <>
          {[0, 1].map((k) => {
            const ok = k === 1;
            const prog = ok ? both : one;
            const done = prog >= 1;
            return (
              <Card
                key={k}
                active={ok && done}
                style={{
                  left: 80 + k * (W + 40),
                  top: 750,
                  width: W,
                  height: 330,
                  opacity: panel,
                  transform: `translateY(${(1 - panel) * 80}px)`,
                }}
              >
                <svg width={W} height={210} style={{position: 'absolute', top: 0, left: 0}}>
                  <Dash y={120} w={W} />
                  {ok ? (
                    <>
                      <Foot x={W / 2 - 34} y={170 - 110 * prog} />
                      <Foot x={W / 2 + 34} y={170 - 110 * prog} />
                    </>
                  ) : (
                    <>
                      <Foot x={W / 2 - 34} y={170 - 110 * prog} />
                      <Foot x={W / 2 + 34} y={170} color="#16743a" />
                    </>
                  )}
                </svg>
                {done && <div style={abs({right: 26, top: 22})}>{ok ? <CheckIcon size={64} /> : <XIcon size={64} />}</div>}
                <div style={abs({left: 0, right: 0, top: 216, textAlign: 'center'})}>
                  <div style={{fontFamily: F.kr, fontWeight: 900, fontSize: 40, color: ok ? C.text : C.text}}>
                    {ok ? '두 발 다 넘기' : '한 발만 넘음'}
                  </div>
                  <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 30, letterSpacing: '0.06em', color: ok ? C.greenBright : C.red}}>
                    {ok ? 'GOOD REP' : 'NO REP'}
                  </div>
                </div>
              </Card>
            );
          })}
        </>
      )}
    </>
  );
};

// 6. 썰매 — 12.5m 레인 왕복, 랩 1→6, 4에서 "아직!"
export const Sled: React.FC<SceneProps> = ({f, c}) => {
  const laps = [c.laps0, c.lap1, c.lap2, c.lap3, c.lap4, c.lap5, c.lap6];
  let lap = 0;
  for (let i = 1; i <= 6; i++) if (f >= laps[i]) lap = i;
  const seg = Math.min(lap, 5);
  const segT = lap >= 6 ? 1 : interpolate(f, [laps[seg], laps[seg + 1]], [0, 1], clamp);
  const pos = seg % 2 === 0 ? segT : 1 - segT; // 0=왼쪽 끝, 1=오른쪽 끝
  const finalPos = lap >= 6 ? 0 : pos;
  const x0 = 110; // 썰매 중심 x (레인 내부 좌표)
  const x1 = 810;
  const sx = x0 + (x1 - x0) * finalPos;
  const lp = usePop(f, laps[Math.max(lap, 1)], 500, 14);
  const notYet = lap === 4 && f < laps[5];
  const sh = notYet ? shake(f, c.lap4, 16, 14) : 0;
  const done = usePop(f, c.lap6, 300, 14);
  return (
    <>
      <Kicker top={340}>Sled push · pull</Kicker>
      {/* 레인 */}
      <div style={abs({left: 80, top: 430, width: 920, height: 190})}>
        <div style={abs({left: 0, right: 0, top: 50, height: 110, borderRadius: 20, background: C.card, border: `3px solid ${C.border}`})} />
        <div style={abs({left: 40, top: 40, width: 6, height: 130, background: C.neon, boxShadow: `0 0 14px ${C.neon}`})} />
        <div style={abs({left: 874, top: 40, width: 6, height: 130, background: C.neon, boxShadow: `0 0 14px ${C.neon}`})} />
        <div style={abs({left: 0, right: 0, top: 0, textAlign: 'center', fontFamily: F.label, fontWeight: 800, fontSize: 34, letterSpacing: '0.08em', color: C.sub})}>
          12.5M LANE
        </div>
        <div
          style={abs({
            left: sx - 50,
            top: 70,
            width: 100,
            height: 70,
            borderRadius: 12,
            background: GRADIENT_SLED,
            boxShadow: '0 0 24px rgba(45,255,124,0.5)',
          })}
        />
      </div>
      {/* 랩 카운터 */}
      <div style={abs({left: 80, top: 660, display: 'flex', alignItems: 'flex-end', gap: 26, transform: `translateX(${sh}px)`})}>
        <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 56, letterSpacing: '0.06em', color: C.sub, paddingBottom: 40}}>LAP</div>
        <div
          style={{
            fontFamily: F.display,
            fontSize: 300,
            lineHeight: 1,
            transform: `scale(${1.15 - 0.15 * lp})`,
            transformOrigin: 'left bottom',
            color: lap >= 6 ? undefined : '#fff',
          }}
        >
          {lap >= 6 ? <GradText>{lap}</GradText> : Math.max(lap, 1)}
        </div>
        <div style={{fontFamily: F.display, fontSize: 120, color: C.dim, paddingBottom: 20}}>/ 6</div>
      </div>
      {notYet && (
        <div style={abs({left: 620, top: 700, transform: `rotate(${8 + sh * 0.6}deg)`})}>
          <Pill solid color={C.red} style={{fontFamily: F.kr, fontWeight: 900, fontSize: 64, padding: '8px 34px', color: '#fff'}}>
            아직!
          </Pill>
        </div>
      )}
      {f >= c.lap6 && (
        <div style={abs({left: 80, top: 1000, opacity: done, transform: `translateY(${(1 - done) * 30}px)`})}>
          <Pill style={{fontSize: 46, padding: '6px 28px'}}>12.5M × 6 = 75M</Pill>
        </div>
      )}
    </>
  );
};
const GRADIENT_SLED = 'linear-gradient(180deg, #7dffb0 0%, #00d64b 100%)';

// 7. 쉬는 사람 — 앉는 픽토그램 + 옐로카드
type Pose = Record<'head' | 'neck' | 'hip' | 'kL' | 'kR' | 'fL' | 'fR' | 'hL' | 'hR', [number, number]>;
const STAND: Pose = {
  head: [0, -250], neck: [0, -195], hip: [0, -40], kL: [-22, 70], kR: [22, 70], fL: [-28, 180], fR: [28, 180], hL: [-48, -60], hR: [48, -60],
};
const SIT: Pose = {
  head: [-30, -70], neck: [-26, -18], hip: [-10, 140], kL: [70, 90], kR: [90, 96], fL: [150, 180], fR: [170, 180], hL: [-80, 170], hR: [-60, 175],
};
const Figure: React.FC<{t: number; color: string}> = ({t, color}) => {
  const P = (k: keyof Pose): [number, number] => [
    STAND[k][0] + (SIT[k][0] - STAND[k][0]) * t,
    STAND[k][1] + (SIT[k][1] - STAND[k][1]) * t,
  ];
  const seg = (a: keyof Pose, b: keyof Pose) => {
    const [x1, y1] = P(a);
    const [x2, y2] = P(b);
    return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={26} strokeLinecap="round" />;
  };
  const [hx, hy] = P('head');
  return (
    <g>
      {seg('neck', 'hip')}
      {seg('hip', 'kL')}
      {seg('kL', 'fL')}
      {seg('hip', 'kR')}
      {seg('kR', 'fR')}
      {seg('neck', 'hL')}
      {seg('neck', 'hR')}
      <circle cx={hx} cy={hy} r={36} fill={color} />
    </g>
  );
};
export const Rest: React.FC<SceneProps> = ({f, c}) => {
  const sitT = ease(f, c.sit, c.sit + 8);
  const card = usePop(f, c.card, 420, 14);
  const plus = usePop(f, c.plus, 360, 14);
  const fig = sitT > 0.5 ? C.red : C.text;
  return (
    <>
      <Kicker top={340}>Resting partner</Kicker>
      <svg width={520} height={560} style={{position: 'absolute', left: 60, top: 400}}>
        <line x1={40} x2={480} y1={480} y2={480} stroke={C.border} strokeWidth={6} />
        <g transform="translate(240 300)">
          <Figure t={sitT} color={fig} />
        </g>
      </svg>
      {f >= c.card && (
        <div
          style={abs({
            left: 590,
            top: 450,
            width: 300,
            height: 400,
            borderRadius: 22,
            background: C.yellow,
            boxShadow: '0 20px 60px rgba(255,210,63,0.35)',
            transform: `rotate(${12 - 4 * card}deg) scale(${1.8 - 0.8 * card})`,
            opacity: interpolate(card, [0, 0.2], [0, 1], clamp),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#151515',
          })}
        >
          <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 40, letterSpacing: '0.08em'}}>WARNING</div>
          <div style={{fontFamily: F.kr, fontWeight: 900, fontSize: 64}}>1차 경고</div>
        </div>
      )}
      {f >= c.plus && (
        <div style={abs({left: 560, top: 900, transform: `scale(${plus})`, transformOrigin: 'left center'})}>
          <Pill solid color={C.red} style={{fontFamily: F.kr, fontWeight: 900, fontSize: 46, color: '#fff', padding: '8px 28px'}}>
            2차 +20초
          </Pill>
        </div>
      )}
      <div style={abs({left: 80, top: 1010, display: 'flex', gap: 14, opacity: ease(f, 6, 14)})}>
        {['앉기', '눕기', '무릎 꿇기'].map((w) => (
          <Pill key={w} color={C.red} style={{fontFamily: F.kr, fontWeight: 900, fontSize: 32, padding: '6px 20px'}}>
            {w} 금지
          </Pill>
        ))}
      </div>
    </>
  );
};

// 8. 즉시 페널티 — 한 명만 OUT 통과 → +2:00 슬램
export const Penalty: React.FC<SceneProps> = ({f, c}) => {
  const walk = ease(f, c.walk, c.walk + 22);
  const slam = usePop(f, c.slam, 520, 13);
  const sh = shake(f, c.slam, 22, 12);
  return (
    <div style={abs({inset: 0, transform: `translate(${sh}px, ${sh * 0.5}px)`})}>
      <Kicker top={340}>Enter · exit together</Kicker>
      <svg width={1080} height={480} style={{position: 'absolute', left: 0, top: 400}}>
        <defs>
          <filter id="g8" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d="M330 470 V110 Q330 40 400 40 H680 Q750 40 750 110 V470" fill="none" stroke={C.neon} strokeWidth={14} filter="url(#g8)" />
        <text x={540} y={140} textAnchor="middle" fontFamily="Anton" fontSize={90} fill="#fff">
          OUT
        </text>
        {/* A: 혼자 통과 (안쪽으로 멀어짐) */}
        <g transform={`translate(${540 - (1 - walk) * 300} ${410 - walk * 170}) scale(${1 - walk * 0.45})`}>
          <circle r={46} fill={C.green} />
          <text y={18} textAnchor="middle" fontFamily="Anton" fontSize={52} fill="#0b0b0b">
            A
          </text>
        </g>
        {/* B: 뒤에 남음 */}
        <g transform="translate(140 410)">
          <circle r={46} fill="#2c2c2c" stroke={C.dim} strokeWidth={4} />
          <text y={18} textAnchor="middle" fontFamily="Anton" fontSize={52} fill={C.sub}>
            B
          </text>
        </g>
      </svg>
      {f >= c.slam && (
        <div
          style={abs({
            left: 80,
            top: 890,
            display: 'flex',
            alignItems: 'center',
            gap: 30,
            transform: `scale(${2.4 - 1.4 * slam})`,
            transformOrigin: '30% center',
            opacity: interpolate(slam, [0, 0.2], [0, 1], clamp),
          })}
        >
          <div style={{fontFamily: F.display, fontSize: 210, lineHeight: 1, color: C.red, textShadow: '0 0 40px rgba(255,90,79,0.55)'}}>
            +2:00
          </div>
          <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 40, lineHeight: 1.1, letterSpacing: '0.06em', color: C.text}}>
            NO
            <br />
            WARNING
          </div>
        </div>
      )}
    </div>
  );
};

// 9. 논쟁 — HYROX 노렙 vs URBANWAVE ?
export const Debate: React.FC<SceneProps> = ({f, c}) => {
  const l = usePop(f, c.left, 300, 18);
  const r = usePop(f, c.right, 300, 18);
  const blink = Math.floor(f / 6) % 2 === 0 ? 1 : 0.35;
  const br = usePop(f, c.brief, 300, 16);
  return (
    <>
      <Kicker top={340}>Wall ball · mid-air catch</Kicker>
      <Card style={{left: 80, top: 420, width: 440, height: 470, opacity: l, transform: `translateX(${(l - 1) * 300}px)`}}>
        <div style={{padding: 34}}>
          <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 34, letterSpacing: '0.08em', color: C.sub}}>HYROX DOUBLES</div>
          <div style={{fontFamily: F.display, fontSize: 132, lineHeight: 1.05, color: C.red, marginTop: 30}}>NO REP</div>
          <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 32, letterSpacing: '0.05em', color: C.sub, marginTop: 24}}>
            FLYING TRANSITION
          </div>
        </div>
      </Card>
      <Card
        active
        style={{left: 560, top: 420, width: 440, height: 470, opacity: r, transform: `translateX(${(1 - r) * 300}px)`}}
      >
        <div style={{padding: 34}}>
          <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 34, letterSpacing: '0.08em', color: C.green}}>URBANWAVE 2026</div>
          <div style={{fontFamily: F.display, fontSize: 210, lineHeight: 1, marginTop: 6, opacity: blink}}>
            <GradText>?</GradText>
          </div>
          <div style={{fontFamily: F.kr, fontWeight: 900, fontSize: 40, color: C.text, marginTop: 0}}>해석이 갈림</div>
        </div>
      </Card>
      {f >= c.brief - 1 && (
        <div style={abs({left: 80, top: 930, display: 'flex', gap: 18, alignItems: 'center', opacity: br, transform: `translateY(${(1 - br) * 40}px)`})}>
          <Pill solid style={{fontFamily: F.kr, fontWeight: 900, fontSize: 44, padding: '10px 30px'}}>
            브리핑 때 꼭 확인
          </Pill>
          <Pill style={{fontFamily: F.kr, fontWeight: 900, fontSize: 40, padding: '8px 26px'}}>댓글로 ↓</Pill>
        </div>
      )}
    </>
  );
};

// 10. CTA — 버튼 눌림 + "어반" 타이핑 + 계정 + 비공식 표기
export const Cta: React.FC<SceneProps> = ({f, c}) => {
  const btnIn = usePop(f, 0, 260, 16);
  const pressed = f >= c.press && f < c.press + 5;
  const word = '어반';
  const typed = word.slice(0, Math.max(0, Math.min(word.length, Math.floor((f - c.type) / 5) + 1)));
  const bubble = usePop(f, c.type, 320, 16);
  const h = usePop(f, c.handle, 260, 18);
  const caret = Math.floor(f / 8) % 2 === 0;
  return (
    <>
      <Kicker top={340}>Tag your partner</Kicker>
      <div
        style={abs({
          left: 80,
          top: 430,
          padding: '30px 56px',
          borderRadius: 28,
          background: C.green,
          color: '#0b0b0b',
          fontFamily: F.kr,
          fontWeight: 900,
          fontSize: 66,
          boxShadow: pressed ? '0 2px 0 #007a2a' : '0 14px 0 #007a2a, 0 0 40px rgba(0,214,75,0.4)',
          transform: `translateY(${pressed ? 12 : 0}px) scale(${btnIn})`,
          transformOrigin: 'left center',
        })}
      >
        댓글에 &quot;어반&quot; 남기기
      </div>
      {f >= c.type && (
        <div
          style={abs({
            left: 80,
            top: 640,
            transform: `scale(${bubble})`,
            transformOrigin: 'left top',
          })}
        >
          <div
            style={{
              background: C.card,
              border: `3px solid ${C.border}`,
              borderRadius: '30px 30px 30px 6px',
              padding: '22px 40px',
              display: 'flex',
              alignItems: 'center',
              gap: 20,
              minWidth: 360,
            }}
          >
            <div style={{width: 60, height: 60, borderRadius: 30, background: '#2f2f2f', flexShrink: 0}} />
            <div style={{fontFamily: F.kr, fontWeight: 900, fontSize: 70, color: C.text}}>
              {typed}
              <span style={{color: C.green, opacity: caret ? 1 : 0}}>|</span>
            </div>
          </div>
          <div style={{fontFamily: F.kr, fontWeight: 700, fontSize: 34, color: C.sub, marginTop: 16, display: 'flex', alignItems: 'center', gap: 12}}>
            <Arrow size={40} color={C.sub} /> 가이드 보내드려요
          </div>
        </div>
      )}
      {f >= c.handle - 1 && (
        <div style={abs({left: 80, top: 900, opacity: h, transform: `translateY(${(1 - h) * 30}px)`})}>
          <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 84, letterSpacing: '0.02em', color: '#fff'}}>@andrew_h_j</div>
        </div>
      )}
      <div
        style={abs({
          left: 80,
          top: 1420,
          width: 760,
          fontFamily: F.kr,
          fontWeight: 700,
          fontSize: 28,
          lineHeight: 1.45,
          color: C.sub,
          opacity: ease(f, 4, 12),
        })}
      >
        참가자가 만든 비공식 요약
        <br />
        최종 해석은 조직위·현장 심판
      </div>
    </>
  );
};

export const SCENES: Record<string, React.FC<SceneProps>> = {
  hook: Hook,
  compare: Compare,
  numbers: Numbers,
  wavezone: WaveZone,
  lunge: Lunge,
  sled: Sled,
  rest: Rest,
  penalty: Penalty,
  debate: Debate,
  cta: Cta,
};
