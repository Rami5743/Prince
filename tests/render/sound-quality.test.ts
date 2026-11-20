/**
 * The recorded sounds at `quality: high`: the same recording, without
 * the staircase.
 *
 * A browser will not make a buffer at the rate these were recorded at
 * -- `sound_15_leveldoor_sliding` is 2750 Hz and Chromium throws under
 * 3000 -- so every sample is held for a whole number of the new rate's.
 * Holding is exactly what the DAC did, so it is what the original
 * sounded like and it is what `original` must keep. At `high` the same
 * samples are joined by a straight line instead, which takes out the
 * hard edge every 1/8250 of a second and leaves the recording itself
 * untouched: **the sample points are the same numbers**, and that is
 * what is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { SoundPlayer, type AudioSink } from '../../src/render/audio.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));

interface Made { rate: number; data: Float32Array }

/** A sink that keeps every buffer made, so the samples can be read. */
function sink(): { sink: AudioSink; made: Made[] } {
  const made: Made[] = [];
  const it = {
    sampleRate: 44100,
    state: 'running',
    async resume(): Promise<void> {},
    createBuffer(_channels: number, length: number, rate: number): AudioBuffer {
      const data = new Float32Array(length);
      made.push({ rate, data });
      return { getChannelData: () => data, length } as unknown as AudioBuffer;
    },
    createBufferSource(): AudioBufferSourceNode {
      return {
        buffer: null, onended: null,
        connect(): void {}, start(): void {}, stop(): void {},
      } as unknown as AudioBufferSourceNode;
    },
    destination: {} as AudioNode,
    currentTime: 0,
  };
  return { sink: it as unknown as AudioSink, made };
}

/** The door, which is the one recording in the game under 8000 Hz. */
const DOOR = 15;

async function samplesOf(quality: 'original' | 'high'): Promise<Made> {
  const s = sink();
  const player = new SoundPlayer(assets, s.sink);
  player.quality = quality;
  await player.preload(DOOR);
  expect(s.made, `${quality}: the door was read`).toHaveLength(1);
  return s.made[0]!;
}

describe('a recorded sound at the two qualities', () => {
  it('is the same recording, sample point for sample point', async () => {
    const plain = await samplesOf('original');
    const smooth = await samplesOf('high');
    expect(smooth.rate, 'the same rate').toBe(plain.rate);
    expect(smooth.data.length, 'and the same length').toBe(plain.data.length);

    // `hold` is how many output samples one recorded sample became.
    // It is read off the plain buffer rather than assumed: a run of
    // equal values is one held sample.
    let hold = 1;
    while (hold < 64 && plain.data[hold] === plain.data[0]) hold++;
    expect(hold, 'the door really is held, not played at its own rate')
      .toBeGreaterThan(1);

    let moved = 0;
    for (let i = 0; i < plain.data.length; i += hold) {
      expect(smooth.data[i], `sample ${i / hold}`).toBeCloseTo(plain.data[i]!, 6);
      // And between two sample points the smooth one is on its way
      // to the next value while the plain one has not moved.
      const mid = i + (hold >> 1);
      if (mid < plain.data.length) {
        expect(plain.data[mid], `plain holds at ${mid}`).toBe(plain.data[i]);
        if (smooth.data[mid] !== plain.data[i]) moved++;
      }
    }
    expect(moved, 'the staircase is gone from most of the recording')
      .toBeGreaterThan(plain.data.length / hold / 4);
  });

  it('forgets what it read when the quality moves', async () => {
    const s = sink();
    const player = new SoundPlayer(assets, s.sink);
    await player.preload(DOOR);
    expect(s.made).toHaveLength(1);
    // Asking again at the same quality reads nothing: it is cached.
    await player.preload(DOOR);
    expect(s.made).toHaveLength(1);
    player.quality = 'high';
    await player.preload(DOOR);
    expect(s.made, 'the buffer is built again at the new quality').toHaveLength(2);
    expect(player.quality).toBe('high');
  });

  it('starts at the original, so nothing headless hears anything new', () => {
    expect(new SoundPlayer(assets, sink().sink).quality).toBe('original');
  });
});
