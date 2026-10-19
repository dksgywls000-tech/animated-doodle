import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../src/styles.css';
import './demo.css';
import { App } from '../src/App';
import { GAME_IMAGES, ASSET_MAP } from './images';
import { load, reset, save, setImages } from './store';
import { demoCsv } from './api';

setImages(GAME_IMAGES);

// 원본 코드의 '/assets/...' 이미지 경로를 내장 이미지로 바꾼다 (썸네일 경로 포함)
const fix = (src: string) => ASSET_MAP[src.replace('_thumb.jpg', '.jpg')] ?? src;
new MutationObserver((list) => {
  for (const m of list) {
    const nodes = m.type === 'attributes' ? [m.target as Element] : [...m.addedNodes].filter((n): n is Element => n instanceof Element);
    for (const n of nodes) {
      const imgs = n.tagName === 'IMG' ? [n as HTMLImageElement] : [...n.querySelectorAll('img')];
      for (const img of imgs) { const s = img.getAttribute('src'); if (s?.startsWith('/assets/')) img.setAttribute('src', fix(s)); }
    }
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });

// CSV 내보내기 링크는 브라우저에서 직접 파일을 만든다
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a[href^="/api/"]') as HTMLAnchorElement | null;
  if (!a) return;
  e.preventDefault();
  const out = demoCsv(a.getAttribute('href')!);
  if (!out) { alert('권한이 없거나 데모에서 지원하지 않는 내보내기입니다.'); return; }
  const url = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = out.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}, true);

function DemoPanel() {
  const [open, setOpen] = useState(() => { try { return !localStorage.getItem('fd-demo-seen'); } catch { return true; } });
  const [clock, setClock] = useState(() => load().clock);
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const f = () => setHash(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  const close = () => { setOpen(false); try { localStorage.setItem('fd-demo-seen', '1'); } catch { /* ignore */ } };
  const setTime = (v: string) => { const s = load(); s.clock = v; save(s); setClock(v); location.reload(); };
  if (!open) return hash.startsWith('#/chat') || hash.startsWith('#/admin') ? null : <button className="demo-fab" onClick={() => setOpen(true)} aria-label="데모 안내 열기">DEMO</button>;
  return (
    <div className="demo-panel" role="dialog" aria-label="데모 안내">
      <div className="between"><b>미리보기 데모</b><button className="btn btn-plain btn-s" onClick={close}>닫기</button></div>
      <p className="small" style={{ marginTop: 6 }}>설치 없이 화면을 둘러보는 <b>가짜 데이터</b> 데모입니다. 데이터는 이 브라우저에만 저장되고 다른 사람과 공유되지 않습니다. <b>실제 행사에는 서버 버전</b>을 사용하세요.</p>
      <table className="demo-acc"><tbody>
        <tr><td>테스트총괄</td><td>TEST-0001</td><td>owner</td></tr>
        <tr><td>테스트관리자</td><td>TEST-0002</td><td>관리자</td></tr>
        <tr><td>테스트참가자 다</td><td>TEST-0005</td><td>3조</td></tr>
        <tr><td>테스트참가자 마</td><td>TEST-0007</td><td>5조</td></tr>
      </tbody></table>
      <p className="xs muted" style={{ marginTop: 6 }}>이 파일을 탭 2개로 열어 관리자·참가자로 각각 입장하면 점수·채팅 실시간 반영을 볼 수 있습니다. 취소 비밀번호는 1234입니다.</p>
      <label className="field" style={{ marginTop: 10 }}>
        <span className="label" style={{ fontSize: 13 }}>‘지금·다음’ 시각</span>
        <select className="select" value={clock} onChange={(e) => setTime(e.target.value)}>
          <option value="real">실제 현재 시각</option>
          {['12:15', '13:17', '13:45', '14:10', '14:35', '15:20', '16:20', '16:50'].map((t) => <option key={t} value={t}>행사 당일 {t}로 가정</option>)}
        </select>
      </label>
      <button className="btn btn-ghost btn-s" style={{ marginTop: 10 }} onClick={() => { if (confirm('데모 데이터를 모두 지우고 처음 상태로 돌릴까요?')) { reset(); location.hash = ''; location.reload(); } }}>데모 데이터 초기화</button>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<><App /><DemoPanel /></>);
