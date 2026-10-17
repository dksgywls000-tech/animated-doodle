import React, {useMemo} from 'react';
import {AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {Caption, clamp, Header, Tunnel} from './components';
import {sceneCues, sceneSfx, SceneTiming} from './cues';
import timing from './generated/timing.json';
import {loadFonts} from './fonts';
import {SCENES} from './scenes';
import {C} from './theme';

export type ReelProps = {voice: boolean; sfx: boolean; music: boolean; musicVolume: number; musicFile: string; qaNoBg?: boolean};

loadFonts();

const scenes = timing.scenes as SceneTiming[];

// 터널 카메라: 훅에서 빠르게 돌진, 컷마다 짧은 가속, CTA에서 줌아웃
const useTunnelZ = (total: number) =>
  useMemo(() => {
    const z: number[] = [];
    let acc = 0;
    for (let g = 0; g < total; g++) {
      const i = scenes.findIndex((s) => g >= s.startFrame && g < s.startFrame + s.frames);
      const s = scenes[Math.max(i, 0)];
      const t = g - s.startFrame;
      let v = 0.014 + 0.11 * Math.exp(-t / 5);
      if (s.key === 'hook') v = 0.03 + 0.16 * Math.exp(-g / 14);
      if (s.key === 'cta') v = -0.02 - 0.06 * Math.exp(-t / 10);
      acc += v;
      z.push(acc);
    }
    return z;
  }, [total]);

const SceneWrap: React.FC<{s: SceneTiming; index: number; noFlash?: boolean}> = ({s, index, noFlash}) => {
  const f = useCurrentFrame();
  const Comp = SCENES[s.key];
  const c = sceneCues(s) as Record<string, number>;
  const enter = index === 0 ? 1 : interpolate(f, [0, 5], [0, 1], clamp);
  const flash = index === 0 || noFlash ? 0 : interpolate(f, [0, 4], [0.22, 0], clamp);
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          opacity: enter,
          transform: `scale(${1.06 - 0.06 * enter})`,
        }}
      >
        <Comp f={f} n={s.frames} c={c} />
        <Caption text={s.caption} frame={f} instant={index === 0} />
      </AbsoluteFill>
      <Header index={index + 1} total={scenes.length} />
      <AbsoluteFill style={{background: C.neon, opacity: flash, mixBlendMode: 'screen'}} />
    </AbsoluteFill>
  );
};

export const Reel: React.FC<ReelProps> = ({voice, sfx, music, musicVolume, musicFile, qaNoBg}) => {
  const frame = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const z = useTunnelZ(durationInFrames);
  const cur = scenes.find((s) => frame >= s.startFrame && frame < s.startFrame + s.frames) ?? scenes[0];
  const tunnelOpacity = cur.key === 'hook' ? 1 : cur.key === 'cta' ? 0.85 : 0.4;
  return (
    <AbsoluteFill style={{background: C.bg}}>
      {!qaNoBg && <Tunnel z={z[Math.min(frame, z.length - 1)]} opacity={tunnelOpacity} />}
      {scenes.map((s, i) => (
        <Sequence key={s.id} from={s.startFrame} durationInFrames={s.frames} name={`${s.id} ${s.key}`}>
          <SceneWrap s={s} index={i} noFlash={qaNoBg} />
        </Sequence>
      ))}
      {voice &&
        scenes.map((s) => (
          <Sequence key={`v${s.id}`} from={s.startFrame} name={`voice ${s.id}`}>
            <Audio src={staticFile(s.audio)} />
          </Sequence>
        ))}
      {sfx &&
        scenes.flatMap((s, i) =>
          sceneSfx(s, i).map((x, k) => (
            <Sequence key={`s${s.id}-${k}`} from={Math.max(0, s.startFrame + x.frame)} name={`sfx ${x.sfx}`}>
              <Audio src={staticFile(`sfx/${x.sfx}.wav`)} volume={x.vol} />
            </Sequence>
          )),
        )}
      {music && (
        <Audio
          src={staticFile(musicFile)}
          loop
          volume={(f) =>
            musicVolume *
            interpolate(f, [0, 3, durationInFrames - 30, durationInFrames - 1], [0, 1, 1, 0], clamp)
          }
        />
      )}
    </AbsoluteFill>
  );
};
