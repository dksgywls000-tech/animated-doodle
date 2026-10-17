import React from 'react';
import {Composition, Still} from 'remotion';
import {Cover} from './Cover';
import timing from './generated/timing.json';
import {Reel, ReelProps} from './Reel';

const defaults: ReelProps = {voice: true, sfx: true, music: true, musicVolume: 0.065, musicFile: 'bgm/bgm_generated.wav'};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Reel"
      component={Reel}
      durationInFrames={timing.totalFrames}
      fps={timing.fps}
      width={timing.width}
      height={timing.height}
      defaultProps={defaults}
    />
    <Still id="Cover" component={Cover} width={1080} height={1920} />
  </>
);
