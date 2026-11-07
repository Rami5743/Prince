/**
 * The game's sounds, as they sit in the DAT files.
 *
 * A sound is resource `10000 + index` and the first byte says which of
 * three kinds it is. The original shipped one file per kind and picked
 * whichever the player's card could manage:
 *
 * * `DIGISND1..3.DAT` -- recorded sound, for a Sound Blaster. Type 1,
 *   then the rate in hertz, the number of samples, two bytes the original
 *   does not read back, and the bit depth. The samples are unsigned
 *   eight-bit, silence at 128, and nothing is compressed.
 * * `MIDISND1..2.DAT` -- type 2 and then a standard MIDI file, `MThd`
 *   and all, for the music and some of the longer effects.
 * * `IBM_SND1..2.DAT` -- type 0, the PC speaker: a tempo and then a list
 *   of notes, each a sixteen-bit divisor for the 8253 and a length. A
 *   divisor of zero is a rest and one of 0x12 ends the tune.
 *
 * Only some indices exist in each file, so a sound is looked for in the
 * files in turn; `src/render/audio.ts` does that and the playing.
 */

export const SOUND_RESOURCE_BASE = 10000;

export interface DigiSound {
  readonly kind: 'digi';
  /** Samples a second, as the file gives it. */
  readonly rate: number;
  /** Unsigned eight-bit, silence at 128. */
  readonly samples: Uint8Array;
}

export interface MidiSound {
  readonly kind: 'midi';
  /** The standard MIDI file, from `MThd` on. */
  readonly bytes: Uint8Array;
}

/** One note of the PC speaker's tune: a divisor and how long to hold it. */
export interface SpeakerNote {
  /** The 8253's divisor, which is 1193182 / the pitch. 0 is a rest. */
  readonly divisor: number;
  /** How long to hold it, in the tune's own units. */
  readonly length: number;
}

/** The divisor that means the tune is over. */
const SPEAKER_END = 0x12;

export interface SpeakerSound {
  readonly kind: 'speaker';
  readonly tempo: number;
  readonly notes: readonly SpeakerNote[];
}

export type Sound = DigiSound | MidiSound | SpeakerSound;

/**
 * Read one sound resource. Returns null for a payload that is too short
 * to be one, which is what an index the file does not really have looks
 * like -- `IBM_SND1.DAT` has a one-byte entry for sound 1.
 */
export function parseSound(payload: Uint8Array): Sound | null {
  if (payload.length < 2) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  switch (payload[0]) {
    case 1: {
      if (payload.length < 9) return null;
      const rate = dv.getUint16(1, true);
      const count = dv.getUint16(3, true);
      const samples = payload.subarray(8, 8 + count);
      if (samples.length === 0) return null;
      return { kind: 'digi', rate: rate || 11000, samples };
    }
    case 2:
      return { kind: 'midi', bytes: payload.subarray(1) };
    case 0: {
      if (payload.length < 6) return null;
      const tempo = dv.getUint16(1, true);
      const notes: SpeakerNote[] = [];
      for (let o = 3; o + 2 < payload.length; o += 3) {
        const divisor = dv.getUint16(o, true);
        if (divisor === SPEAKER_END) break;
        notes.push({ divisor, length: payload[o + 2] });
      }
      if (notes.length === 0) return null;
      return { kind: 'speaker', tempo, notes };
    }
    default:
      return null;
  }
}
