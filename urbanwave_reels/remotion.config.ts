import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setConcurrency(4);
// 샌드박스/CI처럼 Chrome 다운로드가 막힌 환경이면 REMOTION_BROWSER 로 실행 파일 지정
if (process.env.REMOTION_BROWSER) {
  Config.setBrowserExecutable(process.env.REMOTION_BROWSER);
}
