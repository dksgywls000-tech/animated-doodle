import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errMsg } from '../api';
import { useApi } from '../hooks';
import { IconClose } from '../components/Icons';
import { cx } from '../util';

export interface CouponState {
  active: boolean;
  title: string;
  id: string | null;
  /** 이 사람의 쿠폰 — 배포 시점에 입장하지 않았으면 null */
  mine: { win: boolean; scratched: boolean } | null;
}

/** 메인(내 패스)의 스크래치 쿠폰 카드 */
export function CouponCard() {
  const { data, reload } = useApi<CouponState>('/api/coupon', (ev) => ev.type === 'public_changed');
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const { active, mine, title } = data;
  const scratched = !!mine?.scratched;
  const ready = active && !!mine && !scratched;

  return (
    <section aria-label="스크래치 쿠폰" style={{ marginTop: 16 }}>
      <button
        className={cx('coupon', ready && 'ready', scratched && mine?.win && 'won', !active && 'locked')}
        onClick={() => ready && setOpen(true)}
        disabled={!ready}
        aria-label={ready ? '스크래치 쿠폰 열기' : '스크래치 쿠폰'}
      >
        <span className="coupon-edge" aria-hidden="true" />
        <span className="coupon-body">
          <span className="coupon-kicker">SCRATCH COUPON</span>
          <span className="coupon-title">
            {!active && !scratched && '쿠폰이 잠겨 있어요'}
            {ready && '지금 긁어 보세요!'}
            {active && !mine && '이번 쿠폰 대상이 아니에요'}
            {scratched && (mine!.win ? '스페셜 선물 당첨!' : '아쉽지만 다음 기회에')}
          </span>
          <span className="coupon-sub">
            {!active && !scratched && '행사 중간에 운영진이 열어 드립니다'}
            {ready && `${title} 당첨에 도전 · 눌러서 크게 보기`}
            {active && !mine && '배포 시점에 입장한 분께 드렸어요'}
            {scratched && (mine!.win ? `${title} — 운영지원 부스에서 이 화면을 보여 주세요` : '함께해 주셔서 고맙습니다')}
          </span>
        </span>
        <span className="coupon-foil" aria-hidden="true">{ready ? '긁기' : scratched ? (mine!.win ? 'WIN' : '—') : '잠김'}</span>
      </button>
      {open && mine && <ScratchModal win={mine.win} title={title} onClose={() => { setOpen(false); void reload(); }} />}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────

function ScratchModal({ win, title, onClose }: { win: boolean; title: string; onClose: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const sound = useRef<CouponSound | null>(null);
  const saved = useRef(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    const o = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = o; sound.current?.close(); };
  }, [onClose]);

  const onFirstTouch = useCallback(() => { sound.current ??= new CouponSound(); sound.current.resume(); }, []);
  const reveal = useCallback(() => {
    if (saved.current) return;
    saved.current = true;
    setRevealed(true);
    if (win) sound.current?.win(); else sound.current?.lose();
    api('POST', '/api/coupon/scratch').catch((e) => console.warn(errMsg(e)));
  }, [win]);

  return createPortal(
    <div className={cx('scratch-scrim', revealed && win && 'celebrate')} role="dialog" aria-modal="true" aria-label="스크래치 쿠폰">
      {revealed && win && <Rainbow />}
      <button className="scratch-close" onClick={onClose} aria-label="닫기"><IconClose size={26} /></button>
      <div className="scratch-wrap">
        <p className="scratch-hint" aria-live="polite">{revealed ? (win ? '축하합니다!' : '결과가 나왔어요') : '손가락으로 은박을 문질러 주세요'}</p>
        <div className={cx('scratch-card', revealed && 'revealed', win ? 'is-win' : 'is-lose')}>
          <div className="scratch-prize">
            {win ? (
              <>
                <span className="prize-kicker">SPECIAL GIFT</span>
                <strong className="prize-title rainbow-text">스페셜 선물 당첨!</strong>
                <span className="prize-item">{title}</span>
              </>
            ) : (
              <>
                <span className="prize-kicker">THANK YOU</span>
                <strong className="prize-title">다음 기회에!</strong>
                <span className="prize-item">행운권 추첨이 아직 남아 있어요</span>
              </>
            )}
          </div>
          {!revealed && <ScratchLayer onStart={onFirstTouch} onDone={reveal} />}
        </div>
        {revealed && (
          <div className="scratch-result" role="status">
            {win ? (
              <><b>{title}</b> 당첨! 운영지원 부스에서 이 화면을 보여 주시면 선물을 드려요.</>
            ) : (
              <>아쉽지만 이번엔 꽝이에요. 16:45 행운권 경품추첨을 기대해 주세요!</>
            )}
          </div>
        )}
        {revealed && <button className="btn btn-lime" onClick={onClose} style={{ marginTop: 16 }}>확인</button>}
        {!revealed && <button className="btn btn-plain" style={{ marginTop: 12, color: 'rgba(255,255,255,.75)' }} onClick={() => { onFirstTouch(); reveal(); }}>한 번에 열기</button>}
      </div>
    </div>,
    document.body,
  );
}

/** 은박 긁기 캔버스 — 45% 이상 긁으면 자동 공개 */
function ScratchLayer({ onStart, onDone }: { onStart: () => void; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const moves = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    // 확대 애니메이션 중에도 실제 크기로 — getBoundingClientRect는 transform이 적용된 크기라 쓰지 않는다
    const r = { width: c.offsetWidth, height: c.offsetHeight };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.scale(dpr, dpr);
    // 은박: 금속 그라데이션 + 잔결 + 안내 문구
    const g = ctx.createLinearGradient(0, 0, r.width, r.height);
    g.addColorStop(0, '#B9BEB8'); g.addColorStop(.35, '#E9ECE6'); g.addColorStop(.5, '#C7CCC5'); g.addColorStop(.75, '#EEF0EB'); g.addColorStop(1, '#AEB4AD');
    ctx.fillStyle = g; ctx.fillRect(0, 0, r.width, r.height);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '90,100,92'},${Math.random() * .18})`;
      ctx.fillRect(Math.random() * r.width, Math.random() * r.height, 1.4, 1.4);
    }
    ctx.strokeStyle = 'rgba(80,90,84,.18)'; ctx.lineWidth = 1;
    for (let y = 10; y < r.height; y += 9) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.width, y + 6); ctx.stroke(); }
    ctx.fillStyle = 'rgba(23,38,30,.72)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 22px "Pretendard Variable", Pretendard, sans-serif';
    ctx.fillText('여기를 긁어 주세요', r.width / 2, r.height / 2 - 12);
    ctx.font = '700 13px "Pretendard Variable", Pretendard, sans-serif';
    ctx.fillText('SCRATCH · 2026 AUTUMN FIELD CLUB', r.width / 2, r.height / 2 + 16);
  }, []);

  const pos = (e: React.PointerEvent) => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.offsetWidth / r.width), y: (e.clientY - r.top) * (c.offsetHeight / r.height) };
  };
  const scratch = (p: { x: number; y: number }) => {
    const ctx = ref.current!.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';  // 은박 결을 그릴 때 쓴 반투명 색이 남아 있으면 덜 지워진다
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 38;
    ctx.beginPath();
    const from = last.current ?? p;
    ctx.moveTo(from.x, from.y); ctx.lineTo(p.x + 0.01, p.y);
    ctx.stroke();
    last.current = p;
    if (++moves.current % 8 === 0) check();
  };
  const check = () => {
    if (done.current) return;
    const c = ref.current!; const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let clear = 0, total = 0;
    for (let i = 3; i < data.length; i += 4 * 24) { total++; if (data[i] < 40) clear++; }
    if (clear / total > 0.45) { done.current = true; onDone(); }
  };

  return (
    <canvas
      ref={ref}
      className="scratch-layer"
      aria-label="은박 — 문질러서 결과 확인"
      onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); onStart(); drawing.current = true; last.current = null; scratch(pos(e)); }}
      onPointerMove={(e) => { if (drawing.current) scratch(pos(e)); }}
      onPointerUp={() => { drawing.current = false; last.current = null; check(); }}
      onPointerCancel={() => { drawing.current = false; last.current = null; }}
    />
  );
}

/** 무지개 효과: 회전하는 무지개 빛 + 무지개 색종이 */
function Rainbow() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = ref.current!; const ctx = c.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = innerWidth, H = innerHeight;
    c.width = W * dpr; c.height = H * dpr; ctx.scale(dpr, dpr);
    const colors = ['#FF4D4D', '#FF9A3C', '#FFD93D', '#6BD66B', '#3EC1F3', '#4D6BFF', '#A05CFF'];
    // 가운데에서 터지는 무지개 색종이 + 위에서 쏟아지는 색종이
    const burst = Array.from({ length: 110 }, (_, i) => {
      const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.1; const v = 6 + Math.random() * 9;
      return { x: W / 2, y: H * .45, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: colors[i % colors.length] };
    });
    const rain = Array.from({ length: 140 }, (_, i) => ({ x: Math.random() * W, y: -20 - Math.random() * H * 1.2, vx: (Math.random() - .5) * 1.5, vy: 2.2 + Math.random() * 2.5, c: colors[i % colors.length] }));
    const bits = [...burst, ...rain].map((b) => ({ ...b, w: 6 + Math.random() * 7, h: 3 + Math.random() * 5, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3, sway: Math.random() * Math.PI * 2 }));
    let raf = 0; const t0 = performance.now(); let prev = t0;
    const DUR = 5200;
    const tick = (t: number) => {
      const k = Math.min(3, (t - prev) / 16.7); prev = t;   // 기기 속도와 관계없이 같은 속도
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, Math.min(1, (DUR - (t - t0)) / 800));
      for (const b of bits) {
        b.vy = Math.min(b.vy + .22 * k, 5.5); b.vx *= Math.pow(.985, k); b.sway += .08 * k;
        b.x += (b.vx + Math.sin(b.sway) * .8) * k; b.y += b.vy * k; b.r += b.vr * k;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.scale(1, Math.abs(Math.cos(b.sway * 1.7)) * .7 + .3);
        ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      if (t - t0 < DUR) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div className="rainbow-halo" aria-hidden="true" />
      <div className="rainbow-arc" aria-hidden="true" />
      <canvas ref={ref} className="confetti" aria-hidden="true" />
    </>
  );
}

/** 효과음 — 파일 없이 브라우저에서 바로 합성 */
class CouponSound {
  private ctx: AudioContext | null = null;
  resume() {
    try {
      this.ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      void this.ctx.resume();
    } catch { /* 소리를 못 내는 기기 */ }
  }
  private note(freq: number, at: number, dur: number, type: OscillatorType = 'triangle', vol = 0.22) {
    const ctx = this.ctx; if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime + at);
    g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + dur + 0.05);
  }
  /** 경쾌한 팡파르: 도-미-솔-도↑ 상승 + 반짝임 */
  win() {
    this.resume();
    const seq = [523.25, 659.25, 783.99, 1046.5];
    seq.forEach((f, i) => this.note(f, i * 0.09, 0.22, 'square', 0.12));
    [1046.5, 1318.5, 1568].forEach((f) => this.note(f, 0.4, 0.7, 'triangle', 0.16));
    [2093, 2637, 3136, 2637, 3520].forEach((f, i) => this.note(f, 0.55 + i * 0.07, 0.16, 'sine', 0.07));
  }
  lose() {
    this.resume();
    this.note(523.25, 0, 0.18, 'triangle', 0.12);
    this.note(392, 0.16, 0.32, 'triangle', 0.1);
  }
  close() { void this.ctx?.close().catch(() => {}); }
}
