/**
 * One channel, as the hardware had.
 *
 * The original plays one sound at a time: starting one stops whatever is
 * in the channel, which is why the byte-code can ask for silence by name.
 * The port started a new `AudioBufferSourceNode` for every sound and let
 * them pile up, and with the falling whoosh going off on every footstep
 * that came out as a wail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { SoundPlayer, type AudioSink } from '../../src/render/audio.ts';
import { SOUND_SILENCE } from '../../src/game/sequence.ts';
import { SOUND } from '../../src/game/traps.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));

interface FakeSource {
  started: boolean;
  stopped: boolean;
  buffer: unknown;
  onended: (() => void) | null;
}

/** Enough of a `AudioContext` to see what the player does with it. */
function fakeSink(): { sink: AudioSink; sources: FakeSource[]; resumed: number } {
  const sources: FakeSource[] = [];
  const state = { resumed: 0 };
  const sink = {
    sampleRate: 44100,
    state: 'suspended',
    async resume(): Promise<void> { state.resumed += 1; },
    createBuffer(_channels: number, length: number): AudioBuffer {
      const data = new Float32Array(length);
      return { getChannelData: () => data, length } as unknown as AudioBuffer;
    },
    createBufferSource(): AudioBufferSourceNode {
      const s: FakeSource = { started: false, stopped: false, buffer: null, onended: null };
      sources.push(s);
      return {
        set buffer(b: unknown) { s.buffer = b; },
        get buffer(): unknown { return s.buffer; },
        set onended(f: () => void) { s.onended = f; },
        connect(): void { /* nothing to connect to */ },
        start(): void { s.started = true; },
        stop(): void { s.stopped = true; },
      } as unknown as AudioBufferSourceNode;
    },
    destination: {} as AudioNode,
  };
  return { sink, sources, get resumed() { return state.resumed; } };
}

describe('the sound player', () => {
  it('says nothing until the page has been touched', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.preload(SOUND.footstep);
    player.play(SOUND.footstep);
    expect(f.sources).toHaveLength(0);
    await player.wake();
    player.play(SOUND.footstep);
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0].started).toBe(true);
  });

  it('stops the sound in the channel before starting the next', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preloadAll([SOUND.footstep, SOUND.bumped]);
    player.play(SOUND.footstep);
    player.play(SOUND.bumped);
    expect(f.sources).toHaveLength(2);
    expect(f.sources[0].stopped, 'the first is cut off').toBe(true);
    expect(f.sources[1].stopped, 'the second is left playing').toBe(false);
  });

  it('empties the channel when the byte-code asks for silence', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preload(SOUND.footstep);
    player.play(SOUND.footstep);
    player.play(SOUND_SILENCE);
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0].stopped).toBe(true);
  });

  it('does not stop anything for a sound it has no recording of', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preloadAll([SOUND.footstep, 9999]);
    player.play(SOUND.footstep);
    player.play(9999);
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0].stopped).toBe(false);
  });

  /**
   * `sound_15_leveldoor_sliding`, which the game asks for on every one
   * of the forty-two ticks the way out of the level takes to open.
   */
  const LEVELDOOR_SLIDING = 15;

  it('lets a sound that may not be interrupted run to its end', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preloadAll([LEVELDOOR_SLIDING, SOUND.footstep]);
    for (let tick = 0; tick < 42; tick++) player.play(LEVELDOOR_SLIDING);
    expect(f.sources, 'started once, not forty-two times').toHaveLength(1);
    expect(f.sources[0].stopped).toBe(false);
    player.play(SOUND.footstep);
    expect(f.sources, 'and a footstep does not cut it off').toHaveLength(1);
  });

  it('plays a sound that was asked for while it was still being read', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    player.play(SOUND.footstep); // not loaded yet: starts the read
    expect(f.sources).toHaveLength(0);
    await player.preload(SOUND.footstep);
    expect(f.sources, 'it is played when it lands').toHaveLength(1);
    expect(f.sources[0].started).toBe(true);
  });

  it('plays nothing at all while it is muted', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preload(SOUND.footstep);
    player.muted = true;
    player.play(SOUND.footstep);
    expect(f.sources).toHaveLength(0);
  });
});
