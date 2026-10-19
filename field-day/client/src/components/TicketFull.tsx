import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Me } from '../session';
import { formatTicket } from '../util';
import { IconClose } from './Icons';

/** 야외에서 보여주기 쉬운 전체 화면 행운권. 화면 아무 곳이나 눌러도 닫힘 */
export function TicketFull({ me, onClose }: { me: Me; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    // 화면이 꺼지지 않게 요청(지원 브라우저만)
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as any).wakeLock?.request?.('screen').then((l: any) => { lock = l; }).catch(() => {});
    return () => { document.removeEventListener('keydown', k); void lock?.release().catch(() => {}); };
  }, [onClose]);
  return createPortal(
    <div className="ticket-full" role="dialog" aria-modal="true" aria-label="행운권 크게 보기" onClick={onClose}>
      <button ref={btn} className="close" onClick={onClose} aria-label="닫기"><IconClose size={28} /></button>
      <div className="lbl">LUCKY TICKET · 행운권</div>
      <div className="no num">{formatTicket(me.ticketNumber)}</div>
      <div className="who">{me.teamName} · {me.name}</div>
      <div className="tap">화면을 누르면 닫힙니다</div>
    </div>,
    document.body,
  );
}
