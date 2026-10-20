import { ReturnBusCard } from '../components/ReturnBus';
import { useState } from 'react';
import { useApi } from '../hooks';
import { useMe } from '../session';
import { SEAT_SPOTS } from '../util';
import { ImageViewer, type Spot } from '../components/ImageViewer';
import { IconExpand } from '../components/Icons';
import type { EventInfo } from '../types';

const TABS = [
  ['seat', '내 조 자리'], ['toilet', '화장실'], ['support', '운영지원·보건실'], ['bus', '버스'], ['parking', '주차'],
] as const;

interface MapDef { src: string; title: string; alt: string; spot?: Spot }

export function Maps({ route, go }: { route: string; go: (r: string) => void }) {
  const { me } = useMe();
  const key = (route.split('/')[2] ?? 'seat') as (typeof TABS)[number][0];
  const ev = useApi<{ event: EventInfo }>('/api/schedule', (e) => e.type === 'public_changed' && e.data?.what === 'event');
  const event = ev.data?.event;
  const seat = SEAT_SPOTS[me.teamNumber];

  return (
    <main className="page">
      <div className="topbar"><span className="eyebrow">FIELD GUIDE<span className="dot" />부락산 분수공원</span></div>
      <h1 className="h-title" style={{ marginTop: 8 }}>안내 지도</h1>
      <div className="map-tabs">
        <div className="chips scroll" role="tablist" aria-label="지도 종류">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={key === k} className="chip" aria-pressed={key === k} onClick={() => go('/map/' + k)}>{l}</button>)}
        </div>
      </div>

      {key === 'seat' && (
        <MapBlock map={{ src: '/assets/04_team_seating.jpg', title: '조별 자리 배치도', alt: '잔디밭 위 1~8조 자리, 운영지원·응급보건실, 푸드트럭 위치가 표시된 배치도', spot: { x: seat[0], y: seat[1], label: me.teamName } }}>
          <h3>{me.teamName} 자리</h3>
          <p className="small" style={{ marginTop: 4 }}>{me.seatNote}</p>
          <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li>잔디 위 장판은 별도로 지급됩니다. 그늘 공간으로 이동할 수 있어요.</li>
            <li>인원 확인 때는 조끼를 입고 조별 2줄로 섭니다. 단상에서 잔디밭을 볼 때 왼쪽부터 1~8조입니다.</li>
          </ul>
        </MapBlock>
      )}
      {key === 'toilet' && (
        <MapBlock map={{ src: '/assets/05_activity_layout.jpg', title: '경기장·화장실 배치도', alt: '메인 경기장, 화장실, 자율 놀이 구역이 표시된 배치도', spot: { x: 84, y: 80, label: '화장실' } }}>
          <h3>화장실</h3>
          <p className="small" style={{ marginTop: 4 }}>배치도 오른쪽 아래, 잔디밭 가장자리에 있습니다.</p>
          <p className="small muted" style={{ marginTop: 6 }}>메인 경기장은 잔디밭 아래쪽, 오재미·딱지·제기 자율 놀이 구역은 그 아래에 있어요.</p>
        </MapBlock>
      )}
      {key === 'support' && (
        <MapBlock map={{ src: '/assets/04_team_seating.jpg', title: '운영지원·응급보건실', alt: '조별 자리와 푸드트럭 사이의 운영지원 및 응급보건실 위치가 표시된 배치도', spot: { x: 44.4, y: 82, label: '운영지원·보건실' } }}>
          <h3>운영지원·응급보건실</h3>
          <p className="small" style={{ marginTop: 4 }}>조별 자리와 푸드트럭 근처에 있습니다.</p>
          <div className="warn-card" style={{ marginTop: 10 }}>다치거나 몸이 안 좋으면 앱으로 기다리지 말고 이곳으로 바로 와 주세요.</div>
        </MapBlock>
      )}
      {key === 'bus' && (
        <>
          <MapBlock map={{ src: '/assets/02_bus_boarding_map.jpg', title: '출발 버스 탑승지', alt: '출발 버스 1~4호차 탑승 위치가 화살표로 표시된 지도' }}>
            <h3>출발 · 탑승지</h3>
            <p className="small" style={{ marginTop: 4 }}>{event?.departureNote || '기존 귀향/퇴근버스 탑승지에서 출발합니다.'}</p>
          </MapBlock>
          <div style={{ height: 12 }} />
          <MapBlock map={{ src: '/assets/03_venue_access_map.jpg', title: '하차장 → 행사장', alt: '부락산 분수공원 분수광장 하차장과 야외공연장 행사장 위치가 표시된 지도' }}>
            <h3>하차장과 행사장은 다릅니다</h3>
            <p className="small" style={{ marginTop: 4 }}><b>하차</b> 부락산 분수공원 분수광장 → <b>도보 이동</b> → <b>행사장</b> 야외공연장(지도 위쪽 노란 원)</p>
          </MapBlock>
          <div style={{ height: 12 }} />
          <ReturnBusCard />
        </>
      )}
      {key === 'parking' && (
        <MapBlock map={{ src: '/assets/03_venue_access_map.jpg', title: '주차 · 행사장 접근', alt: '이충문화체육센터 주차장(P)과 행사장 위치가 표시된 지도' }}>
          <h3>자차 이용</h3>
          {event?.parking ? <p className="small" style={{ marginTop: 4 }}>{event.parking}</p> : <p className="small muted" style={{ marginTop: 4 }}>주차 안내는 운영진 확인 후 공개됩니다.</p>}
          <p className="xs muted" style={{ marginTop: 6 }}>지도 오른쪽 ‘P’ 표시가 이충문화체육센터 주차장입니다.</p>
        </MapBlock>
      )}
      <p className="xs muted" style={{ marginTop: 16 }}>지도는 행사 안내문 원본 이미지이며 실시간 위치·GPS 정보가 아닙니다.</p>
    </main>
  );
}

function MapBlock({ map, children }: { map: MapDef; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="map-card">
      <button className="map-thumb" onClick={() => setOpen(true)} aria-label={`${map.title} 크게 보기`}>
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <img src={map.src.replace('.jpg', '_thumb.jpg')} alt={map.alt} loading="lazy" />
          {map.spot && (
            <>
              <span className="spot" style={{ left: `${map.spot.x}%`, top: `${map.spot.y}%` }} aria-hidden="true" />
              <span className="spot-label" style={{ left: `${map.spot.x}%`, top: `calc(${map.spot.y}% + 6.5%)` }} aria-hidden="true">{map.spot.label}</span>
            </>
          )}
        </div>
        <span className="expand"><IconExpand size={16} />크게 보기</span>
      </button>
      <div className="map-info">{children}</div>
      {open && <ImageViewer src={map.src} alt={map.alt} title={map.title} spot={map.spot} onClose={() => setOpen(false)} />}
    </section>
  );
}
