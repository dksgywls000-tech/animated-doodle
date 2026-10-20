/** 퇴근버스 배차 — 화면 코드에 고정(데이터 수정 없이 바로 반영) */
export const RETURN_BUS = {
  time: '17:40',
  place: '이충동 분수공원 앞',
  buses: [
    { no: 1, from: '아이파크', to: '용이 · 비전 노선' },
    { no: 2, from: '블루시티', to: '고덕 노선' },
    { no: 3, from: '블루시티', to: '상공회의소' },
    { no: 4, from: '블루시티', to: null },
    { no: 5, from: '블루시티', to: null },
  ],
};

export function ReturnBusCard({ compact }: { compact?: boolean }) {
  return (
    <section className={compact ? 'bus-card compact' : 'bus-card'} aria-label="퇴근버스 안내">
      <div className="bus-head">
        {!compact && <span className="bus-time num">{RETURN_BUS.time}</span>}
        <div>
          {!compact && <div className="bus-kicker">RETURN BUS · 퇴근버스</div>}
          <div className="bus-place">{RETURN_BUS.place} 출발</div>
        </div>
      </div>
      <ul className="bus-list">
        {RETURN_BUS.buses.map((b) => (
          <li key={b.no}>
            <span className="bus-no num">{b.no}<small>호차</small></span>
            <span className="bus-route">
              <b>{b.from}</b>
              {b.to && <><span className="bus-arrow" aria-label="경유 후">→</span><span>{b.to}</span></>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
