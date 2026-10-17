import React from 'react';
import {AbsoluteFill} from 'remotion';
import {GradText, Tunnel} from './components';
import {loadFonts} from './fonts';
import {C, F} from './theme';

loadFonts();

// 커버: 프로필 그리드에서 보이는 가운데 4:5 (y 285–1635) 안에 제목 배치
export const Cover: React.FC = () => (
  <AbsoluteFill style={{background: C.bg}}>
    <Tunnel z={0.35} opacity={0.9} />
    <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(22,22,22,0) 35%, rgba(22,22,22,0.75) 70%)'}} />
    <div style={{position: 'absolute', left: 80, right: 80, top: 600}}>
      <div style={{fontFamily: F.label, fontWeight: 800, fontSize: 36, letterSpacing: '0.08em', color: '#cfcfcf', marginBottom: 28}}>
        URBANWAVE 2026 · DOUBLES
      </div>
      <div style={{fontFamily: F.display, fontSize: 150, lineHeight: 0.98, color: '#fff'}}>
        DON&apos;T RUN IT
        <br />
        <GradText>LIKE HYROX.</GradText>
      </div>
      <div
        style={{
          fontFamily: F.kr,
          fontWeight: 900,
          fontSize: 118,
          lineHeight: 1.16,
          letterSpacing: '-0.03em',
          color: C.text,
          marginTop: 40,
          wordBreak: 'keep-all',
        }}
      >
        하이록스처럼 뛰면
        <br />
        <GradText>실격</GradText>입니다
      </div>
      <div style={{fontFamily: F.kr, fontWeight: 700, fontSize: 40, color: C.sub, marginTop: 30}}>
        어반웨이브 더블 나가는 사람만 보세요
      </div>
    </div>
  </AbsoluteFill>
);
