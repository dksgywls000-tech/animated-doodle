import React from 'react';
import {interpolate, spring, useVideoConfig} from 'remotion';
import {C, CAPTION, F, GRAD} from './theme';

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// 0→1 스프링 (팝 인)
export const usePop = (frame: number, at: number, stiffness = 260, damping = 16) => {
  const {fps} = useVideoConfig();
  return spring({frame: frame - at, fps, config: {stiffness, damping, mass: 0.6}});
};

export const ease = (frame: number, from: number, to: number, a = 0, b = 1) =>
  interpolate(frame, [from, to], [a, b], {
    ...clamp,
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

// ---------- 네온 터널 ----------
const VP = {x: 540, y: 800};
export const Tunnel: React.FC<{z: number; opacity?: number; count?: number}> = ({z, opacity = 1, count = 8}) => {
  const spacing = 0.85;
  const rects = [];
  for (let i = 0; i < count; i++) {
    // 깊이: z 가 커질수록 카메라가 앞으로 → 깊이 감소
    let d = ((i * spacing - z) % (count * spacing) + count * spacing) % (count * spacing);
    d += 0.45;
    const s = 1 / d;
    const w = 470 * s;
    const h = 700 * s;
    const fadeFar = interpolate(d, [count * spacing - 1.6, count * spacing + 0.45], [1, 0], clamp);
    const fadeNear = interpolate(d, [0.45, 0.8], [0, 1], clamp);
    const o = Math.min(fadeFar, fadeNear) * interpolate(d, [0.8, 5], [1, 0.35], clamp);
    rects.push(
      <rect
        key={i}
        x={VP.x - w}
        y={VP.y - h}
        width={w * 2}
        height={h * 2}
        fill="none"
        stroke={C.neon}
        strokeWidth={Math.min(14, 7 * s)}
        opacity={o}
      />,
    );
  }
  const corners = [
    [0, 0],
    [1080, 0],
    [0, 1920],
    [1080, 1920],
  ];
  return (
    <svg width={1080} height={1920} style={{position: 'absolute', inset: 0, opacity}}>
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="vig" cx="50%" cy="42%" r="70%">
          <stop offset="0%" stopColor="#0d2a17" stopOpacity="0.55" />
          <stop offset="100%" stopColor={C.bg} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={1080} height={1920} fill="url(#vig)" />
      {corners.map(([x, y], i) => (
        <line key={i} x1={VP.x} y1={VP.y} x2={x} y2={y} stroke="#1f6b3a" strokeWidth={2} opacity={0.55} />
      ))}
      <g filter="url(#glow)">{rects}</g>
    </svg>
  );
};

// ---------- 상단 라벨 ----------
export const Header: React.FC<{index: number; total: number}> = ({index, total}) => (
  <div
    style={{
      position: 'absolute',
      top: 262,
      left: 80,
      right: 80,
      display: 'flex',
      justifyContent: 'space-between',
      fontFamily: F.label,
      fontWeight: 800,
      fontSize: 30,
      letterSpacing: '0.08em',
      color: '#cfcfcf',
    }}
  >
    <span>URBANWAVE 2026 · DOUBLES</span>
    <span style={{color: C.green}}>
      {String(index).padStart(2, '0')} / {String(total).padStart(2, '0')}
    </span>
  </div>
);

export const Kicker: React.FC<{children: React.ReactNode; top: number; color?: string; size?: number}> = ({
  children,
  top,
  color = C.green,
  size = 48,
}) => (
  <div
    style={{
      position: 'absolute',
      top,
      left: 80,
      fontFamily: F.display,
      fontSize: size,
      letterSpacing: '0.02em',
      color,
      textTransform: 'uppercase',
      lineHeight: 1,
    }}
  >
    {children}
  </div>
);

export const GradText: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({children, style}) => (
  <span
    style={{
      background: GRAD,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      ...style,
    }}
  >
    {children}
  </span>
);

// ---------- 아이콘 (폰트에 없는 기호는 SVG) ----------
export const XIcon: React.FC<{size?: number; color?: string; bg?: string}> = ({size = 60, color = C.red, bg = '#3a1a18'}) => (
  <svg width={size} height={size} viewBox="0 0 60 60" style={{display: 'block'}}>
    <circle cx={30} cy={30} r={30} fill={bg} />
    <path d="M19 19 L41 41 M41 19 L19 41" stroke={color} strokeWidth={6} strokeLinecap="round" />
  </svg>
);
export const CheckIcon: React.FC<{size?: number; color?: string; bg?: string}> = ({
  size = 60,
  color = C.greenBright,
  bg = '#0f3a20',
}) => (
  <svg width={size} height={size} viewBox="0 0 60 60" style={{display: 'block'}}>
    <circle cx={30} cy={30} r={30} fill={bg} />
    <path d="M17 31 L26 40 L44 21" stroke={color} strokeWidth={6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const Arrow: React.FC<{size?: number; color?: string; dir?: 'right' | 'down'}> = ({
  size = 50,
  color = C.text,
  dir = 'right',
}) => (
  <svg
    width={size}
    height={size * 0.6}
    viewBox="0 0 50 30"
    style={{display: 'inline-block', verticalAlign: 'middle', transform: dir === 'down' ? 'rotate(90deg)' : undefined}}
  >
    <path d="M2 15 H44 M32 4 L46 15 L32 26" stroke={color} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ---------- 자막 ----------
// **강조** → 그린 그라데이션, ~~취소~~ → 회색 + 빨간 취소선, → 는 SVG 화살표
const renderInline = (text: string, keyBase: string) =>
  text.split('→').flatMap((part, i, arr) => {
    const out: React.ReactNode[] = [<React.Fragment key={`${keyBase}-t${i}`}>{part}</React.Fragment>];
    if (i < arr.length - 1) out.push(<Arrow key={`${keyBase}-a${i}`} size={64} color={C.sub} />);
    return out;
  });

export const parseMarkup = (src: string) => {
  const tokens = src.split(/(\*\*[^*]+\*\*|~~[^~]+~~)/g).filter(Boolean);
  return tokens.map((tok, i) => {
    if (tok.startsWith('**'))
      return <GradText key={i}>{renderInline(tok.slice(2, -2), `b${i}`)}</GradText>;
    if (tok.startsWith('~~'))
      return (
        <span key={i} style={{color: C.dim, position: 'relative', display: 'inline-block'}}>
          {tok.slice(2, -2)}
          <span
            style={{
              position: 'absolute',
              left: -4,
              right: -4,
              top: '54%',
              height: 8,
              background: C.red,
              borderRadius: 4,
              transform: 'rotate(-6deg)',
            }}
          />
        </span>
      );
    return <React.Fragment key={i}>{renderInline(tok, `p${i}`)}</React.Fragment>;
  });
};

export const Caption: React.FC<{text: string; frame: number; instant?: boolean}> = ({text, frame, instant}) => {
  const pop = usePop(frame, 0, 320, 18);
  const p = instant ? 1 : pop;
  return (
    <div
      style={{
        position: 'absolute',
        top: CAPTION.top,
        left: CAPTION.left,
        width: CAPTION.width,
        fontFamily: F.kr,
        fontWeight: 900,
        fontSize: 72,
        lineHeight: 1.22,
        letterSpacing: '-0.02em',
        color: C.text,
        wordBreak: 'keep-all',
        textShadow: '0 4px 24px rgba(0,0,0,0.85)',
        opacity: interpolate(p, [0, 0.4], [0, 1], clamp),
        transform: `translateY(${(1 - p) * 30}px) scale(${0.94 + 0.06 * p})`,
        transformOrigin: 'left center',
      }}
    >
      {parseMarkup(text)}
    </div>
  );
};

// ---------- 카드 ----------
export const Card: React.FC<{
  style?: React.CSSProperties;
  children?: React.ReactNode;
  active?: boolean;
  radius?: number;
}> = ({style, children, active, radius = 26}) => (
  <div
    style={{
      position: 'absolute',
      background: C.card,
      border: `3px solid ${active ? C.green : C.border}`,
      borderRadius: radius,
      boxShadow: active ? `0 0 28px rgba(45,255,124,0.35)` : '0 10px 40px rgba(0,0,0,0.5)',
      boxSizing: 'border-box',
      ...style,
    }}
  >
    {children}
  </div>
);

export const Pill: React.FC<{children: React.ReactNode; style?: React.CSSProperties; solid?: boolean; color?: string}> = ({
  children,
  style,
  solid,
  color = C.green,
}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 22px',
      borderRadius: 999,
      border: `3px solid ${color}`,
      background: solid ? color : 'rgba(22,22,22,0.9)',
      color: solid ? '#0b0b0b' : color,
      fontFamily: F.label,
      fontWeight: 800,
      fontSize: 32,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    {children}
  </div>
);
