import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '../src/styles.css';
import { App } from '../src/App';
import { configMissing } from './fb';
import { exportCsv, errMsg } from './api';

// 관리자 화면의 CSV 다운로드 링크(/api/...csv)를 브라우저에서 만든다
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a[href^="/api/"]') as HTMLAnchorElement | null;
  if (!a) return;
  e.preventDefault();
  exportCsv(a.getAttribute('href')!).then(({ name, csv }) => {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch((err) => alert(errMsg(err)));
}, true);

const root = createRoot(document.getElementById('root')!);
if (configMissing) {
  root.render(
    <div className="state-box" style={{ paddingTop: 120 }}>
      <h3>앱 설정이 비어 있습니다</h3>
      <p>사이트 폴더의 <b>firebase-config.js</b> 파일에 Firebase 연결 정보 4개를 넣고 다시 올려 주세요.</p>
    </div>,
  );
} else if (location.pathname.replace(/\/+$/, '') === '/setup') {
  void import('./Setup').then(({ Setup }) => root.render(<Setup />));
} else {
  root.render(<App />);
}
