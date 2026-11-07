/**
 * The sounds in the DAT files.
 *
 * The port raised every `sound` the byte-code asked for and nothing was
 * listening. These read what there is to listen to, and check that every
 * index the game raises in play has a recorded version: that is what
 * decides whether a player hears the gates, the loose floors and the
 * spikes, or silence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { loadSound, DIGI_FILES } from '../../src/render/audio.ts';
import { parseSound, SOUND_RESOURCE_BASE } from '../../src/dat/sound.ts';
import { DatFile } from '../../src/dat/container.ts';
import { SOUND } from '../../src/game/traps.ts';
import { SEQUENCE_SOUND, SOUND_SILENCE } from '../../src/game/sequence.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));

describe('the recorded sounds', () => {
  it('are eight-bit samples at the rate the file gives', async () => {
    const sound = await loadSound(assets, SOUND.footstep);
    expect(sound?.kind).toBe('digi');
    if (sound?.kind !== 'digi') return;
    // Not every sound was recorded at the same rate; the footstep is 8200
    // and the Prince's voice 11000, and the file says which.
    expect(sound.rate).toBe(8200);
    expect(sound.samples.length).toBeGreaterThan(100);
    // Silence is 128, so a real recording has samples on both sides of it.
    expect(Math.min(...sound.samples)).toBeLessThan(120);
    expect(Math.max(...sound.samples)).toBeGreaterThan(136);
  });

  it('cover every sound the game raises while it is being played', async () => {
    for (const [name, index] of Object.entries(SOUND)) {
      const sound = await loadSound(assets, index);
      expect(sound?.kind, `${name} (${index})`).toBe('digi');
    }
  });

  it('say how long they are in their own header', async () => {
    const dat = new DatFile(
      new Uint8Array(readFileSync(join(GAME_DIR, 'DIGISND1.DAT'))), 'DIGISND1.DAT',
    );
    const payload = dat.get(SOUND_RESOURCE_BASE + SOUND.footstep);
    const sound = parseSound(payload);
    if (sound?.kind !== 'digi') throw new Error('not a recording');
    // Eight bytes of header and then one byte a sample, nothing packed.
    expect(sound.samples.length).toBe(payload.length - 8);
  });
});

describe('the other two kinds', () => {
  it('reads the music as a standard MIDI file', () => {
    const dat = new DatFile(
      new Uint8Array(readFileSync(join(GAME_DIR, 'MIDISND1.DAT'))), 'MIDISND1.DAT',
    );
    const id = dat.entries[0].id;
    const sound = parseSound(dat.get(id));
    expect(sound?.kind).toBe('midi');
    if (sound?.kind !== 'midi') return;
    expect(Array.from(sound.bytes.subarray(0, 4)))
      .toEqual([0x4d, 0x54, 0x68, 0x64]); // MThd
  });

  it('reads the PC speaker version as notes', () => {
    const dat = new DatFile(
      new Uint8Array(readFileSync(join(GAME_DIR, 'IBM_SND1.DAT'))), 'IBM_SND1.DAT',
    );
    const sound = parseSound(dat.get(SOUND_RESOURCE_BASE + SOUND.footstep));
    expect(sound?.kind).toBe('speaker');
    if (sound?.kind !== 'speaker') return;
    expect(sound.notes.length).toBeGreaterThan(0);
  });

  it('refuses a resource that is too short to be a sound', () => {
    expect(parseSound(new Uint8Array([0]))).toBeNull();
    expect(parseSound(new Uint8Array([]))).toBeNull();
  });
});

describe('looking for a sound', () => {
  it('tries each of the three recorded files', async () => {
    expect(DIGI_FILES).toHaveLength(3);
    // 14 is only in the third of them, which is the point of the list.
    const sound = await loadSound(assets, 14);
    expect(sound?.kind).toBe('digi');
  });

  it('gives nothing back for an index no file has', async () => {
    expect(await loadSound(assets, 9999)).toBeNull();
  });
});

/**
 * What the byte-code asks for.
 *
 * `sound`'s argument is one of five small codes, not a sound's number,
 * and the port took it for the number: every frame of every stride
 * played recording 1, which is the second-long falling whoosh, and forty
 * of those over each other is the wail the player heard. These pin the
 * table and the reading of the recordings it rests on.
 */
describe('the sounds the sequences ask for', () => {
  it('maps the five codes to the sounds the recordings fit', () => {
    expect(SEQUENCE_SOUND[0]).toBe(SOUND_SILENCE);
    expect(SEQUENCE_SOUND[1]).toBe(SOUND.footstep);
    expect(SEQUENCE_SOUND[2]).toBe(SOUND.bumped);
    expect(SEQUENCE_SOUND[3]).toBe(SOUND.drink);
  });

  it('plays a footstep for every stride, not a falling whoosh', async () => {
    const step = await loadSound(assets, SEQUENCE_SOUND[1]);
    const fall = await loadSound(assets, 1);
    if (step?.kind !== 'digi' || fall?.kind !== 'digi') throw new Error('missing');
    // A footstep is a tenth of a second; the whoosh is a whole one, and a
    // stride comes round every few ticks.
    expect(step.samples.length / step.rate).toBeLessThan(0.2);
    expect(fall.samples.length / fall.rate).toBeGreaterThan(1);
  });

  it('plays the drink on the frame the Prince swallows', async () => {
    const drink = await loadSound(assets, SEQUENCE_SOUND[3]);
    if (drink?.kind !== 'digi') throw new Error('missing');
    expect(drink.samples.length / drink.rate).toBeGreaterThan(0.5);
  });
});
