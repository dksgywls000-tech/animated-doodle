import { useEffect, useRef } from 'react';
import { cx } from '../util';

export const SCORE_VALUES = Array.from({ length: 20 }, (_, i) => (i + 1) * 10); // 10~200
export const QUICK = [200, 100, 50, 40, 30, 20, 10];
const ITEM_H = 56;

/**
 * 스크롤 스냅 점수 휠. index 0은 '점수 선택'(미선택) 자리.
 * 터치 스크롤·키보드(↑↓, Home/End, PageUp/Down)·클릭 지원.
 */
export function ScoreWheel({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const items: (number | null)[] = [null, ...SCORE_VALUES];
  const idx = value == null ? 0 : items.indexOf(value);
  const programmatic = useRef(false);
  const timer = useRef<number | null>(null);

  // 외부 변경(칩 선택 등)을 휠 위치에 반영
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = idx * ITEM_H;
    if (Math.abs(el.scrollTop - target) > 2) {
      programmatic.current = true;
      el.scrollTo({ top: target, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      window.setTimeout(() => { programmatic.current = false; }, 260);
    }
  }, [idx]);

  const onScroll = () => {
    if (programmatic.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current!;
      const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_H)));
      if (i !== idx) onChange(items[i]);
    }, 90);
  };

  const onKey = (e: React.KeyboardEvent) => {
    let n = idx;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = idx + 1;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = idx - 1;
    else if (e.key === 'PageDown') n = idx + 5;
    else if (e.key === 'PageUp') n = idx - 5;
    else if (e.key === 'Home') n = 1;
    else if (e.key === 'End') n = items.length - 1;
    else return;
    e.preventDefault();
    n = Math.max(0, Math.min(items.length - 1, n));
    onChange(items[n]);
  };

  return (
    <div className="wheel-box">
      <div className="wheel-band" aria-hidden="true" />
      <div
        ref={ref}
        className="wheel"
        role="listbox"
        tabIndex={0}
        aria-label="점수 선택 휠 (10점 단위, 위아래 화살표로 조절)"
        aria-activedescendant={`wheel-${idx}`}
        onScroll={onScroll}
        onKeyDown={onKey}
      >
        {items.map((v, i) => (
          <div
            key={i}
            id={`wheel-${i}`}
            role="option"
            aria-selected={i === idx}
            className={cx('wheel-item num', v == null && 'placeholder', i === idx && 'sel')}
            onClick={() => onChange(v)}
          >
            {v == null ? '점수 선택' : `+${v}`}
          </div>
        ))}
      </div>
      <div className="wheel-fade t" aria-hidden="true" />
      <div className="wheel-fade b" aria-hidden="true" />
    </div>
  );
}
