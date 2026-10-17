import {continueRender, delayRender, staticFile} from 'remotion';

const faces: [string, string, string][] = [
  ['Anton', 'fonts/anton-latin-400-normal.woff2', '400'],
  ['BC', 'fonts/barlow-condensed-latin-600-normal.woff2', '600'],
  ['BC', 'fonts/barlow-condensed-latin-800-normal.woff2', '800'],
  ['NotoKR', 'fonts/noto-sans-kr-korean-700-normal.woff2', '700'],
  ['NotoKR', 'fonts/noto-sans-kr-korean-900-normal.woff2', '900'],
];

let started = false;
export const loadFonts = () => {
  if (started || typeof document === 'undefined') return;
  started = true;
  const handle = delayRender('fonts');
  Promise.all(
    faces.map(([family, file, weight]) => {
      const ff = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, {weight});
      document.fonts.add(ff);
      return ff.load();
    }),
  )
    .then(() => continueRender(handle))
    .catch((e) => {
      console.error(e);
      continueRender(handle);
    });
};
