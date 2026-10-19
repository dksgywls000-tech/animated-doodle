import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconClose, IconMinus, IconPlus } from './Icons';

export interface Spot { x: number; y: number; label: string }

/** 원본 지도 확대 보기 — 핀치·드래그·더블탭·버튼 확대/축소, 닫기 버튼 고정 */
export function ImageViewer({ src, alt, title, spot, onClose }: { src: string; alt: string; title: string; spot?: Spot; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const fit = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ d: number; s: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  const fitAll = useCallback(() => {
    if (!nat || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    const s = Math.min(r.width / nat.w, r.height / nat.h);
    fit.current = s;
    setT({ s, x: (r.width - nat.w * s) / 2, y: (r.height - nat.h * s) / 2 });
  }, [nat]);

  useLayoutEffect(() => { fitAll(); }, [fitAll]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === '+' || e.key === '=') zoomBy(1.4); if (e.key === '-') zoomBy(1 / 1.4); };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fitAll);
    const o = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('resize', fitAll); document.body.style.overflow = o; };
  });

  const clampScale = (s: number) => Math.min(Math.max(s, fit.current * 0.9), fit.current * 6);
  const zoomAt = (factor: number, cx: number, cy: number) => setT((p) => {
    const s = clampScale(p.s * factor);
    const k = s / p.s;
    return { s, x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k };
  });
  const zoomBy = (f: number) => { const r = stage.current!.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); };

  const local = (e: { clientX: number; clientY: number }) => { const r = stage.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 280) { const p = local(e); t.s > fit.current * 1.5 ? fitAll() : zoomAt(2.5, p.x, p.y); }
      lastTap.current = now;
    }
    startGesture();
  };
  const startGesture = () => {
    const pts = [...pointers.current.values()];
    if (!pts.length) { gesture.current = null; return; }
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { d, s: t.s, cx, cy, x: t.x, y: t.y };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, local(e));
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    let s = g.s;
    if (pts.length > 1 && g.d > 0) s = clampScale(g.s * (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.d));
    const k = s / g.s;
    setT({ s, x: cx - (g.cx - g.x) * k, y: cy - (g.cy - g.y) * k });
  };
  const onUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); startGesture(); };
  const onWheel = (e: React.WheelEvent) => { const p = local(e); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y); };

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="viewer-bar">
        <span className="t">{title}</span>
        <button className="viewer-close" onClick={onClose} aria-label="닫기" autoFocus><IconClose /></button>
      </div>
      <div className="viewer-stage" ref={stage} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <div className="inner" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}>
          <img src={src} alt={alt} draggable={false} onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {spot && nat && (
            <>
              <span className="spot" style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: nat.w * 0.1, borderWidth: 6 / t.s, boxShadow: 'none' }} />
              <span className="spot-label" style={{ left: `${spot.x}%`, top: `calc(${spot.y}% + ${nat.w * 0.055}px)`, transform: `translate(-50%,0) scale(${1 / t.s})`, transformOrigin: 'top center' }}>{spot.label}</span>
            </>
          )}
        </div>
      </div>
      <div className="viewer-tools" role="group" aria-label="확대 조절">
        <button onClick={() => zoomBy(1 / 1.4)} aria-label="축소"><IconMinus /></button>
        <button onClick={fitAll} aria-label="전체 보기">전체</button>
        <button onClick={() => zoomBy(1.4)} aria-label="확대"><IconPlus /></button>
      </div>
    </div>,
    document.body,
  );
}
