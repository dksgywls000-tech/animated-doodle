import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconClose } from './Icons';
import { cx } from '../util';

/** 모바일 바텀시트 / 데스크톱 다이얼로그. 포커스 가두기·ESC 닫기·복귀 포커스 */
export function Sheet({ title, onClose, children, footer, wide, labelledBy, closeDisabled }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; labelledBy?: string; closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = labelledBy ?? 'sheet-title-' + title.length;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !closeDisabled) { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey, true); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [onClose, closeDisabled]);
  return createPortal(
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !closeDisabled) onClose(); }}>
      <div className={cx('sheet', wide && 'wide')} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기" disabled={closeDisabled}><IconClose /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
