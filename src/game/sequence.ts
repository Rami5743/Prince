/**
 * The sequence interpreter.
 *
 * Every movement the Prince can make -- a step, a turn, a jump, a fall -- is
 * a short byte-code program in a table inside PRINCE.EXE. Running one frame
 * of animation means running the program until it names a frame, applying
 * whatever it did on the way: shifting the character, flipping it, moving it
 * a row up or down, raising a sound or an action.
 *
 * This runs the original's byte-code directly. The opcodes are the
 * original's, and so is the arithmetic: the character's x and y are single
 * bytes and wrap, which some of the sequences rely on.
 */
import type { ExeTables } from './exe-tables.ts';
import { SEQUENCE_BASE } from './exe-tables.ts';
import type { CharacterState } from './character.ts';
import { forwardX } from './character.ts';

export const SEQ_OP = {
  dx: 0xfb,
  dy: 0xfa,
  flip: 0xfe,
  jumpIfFeather: 0xf7,
  jump: 0xff,
  up: 0xfd,
  down: 0xfc,
  action: 0xf9,
  setFall: 0xf8,
  knockUp: 0xf5,
  knockDown: 0xf4,
  sound: 0xf2,
  endLevel: 0xf1,
  getItem: 0xf3,
  die: 0xf6,
} as const;

/** Sequence ids, as the original numbers them. */
export const SEQ = {
  startRun: 1,
  stand: 2,
  standJump: 3,
  runJump: 4,
  turn: 5,
  runTurn: 6,
  stepFall: 7,
  jumpHangMedium: 8,
  hang: 9,
  climbUp: 10,
  hangDrop: 11,
  freeFall: 12,
  runStop: 13,
  jumpUp: 14,
  fall: 7,
} as const;

/** What the running character is doing, with the original's numbering. */
export const ACTION = {
  stand: 0,
  runJump: 1,
  hangClimb: 2,
  inMidair: 3,
  inFreefall: 4,
  bumped: 5,
  hangStraight: 6,
  turning: 7,
} as const;

export const SOUND = {
  silent: 0,
  footstep: 1,
  bump: 2,
  drink: 3,
  level: 4,
} as const;

/** Side effects a sequence can raise, for the game loop to act on. */
export interface SequenceEffects {
  sound?(which: number): void;
  rowChanged?(delta: number): void;
  knock?(direction: number): void;
  endLevel?(): void;
  getItem?(which: number): void;
  die?(): void;
}

export interface SequenceContext {
  readonly tables: ExeTables;
  /** The upside-down potion makes some jumps behave differently. */
  readonly isFeatherFall?: boolean;
  readonly effects?: SequenceEffects;
}

const u8 = (v: number): number => v & 0xff;
const i8 = (v: number): number => (v << 24) >> 24;

/** Start a character on a sequence, by sequence id. */
export function startSequence(state: CharacterState, id: number, tables: ExeTables): void {
  state.currentSequence = tables.sequenceOffsets[id];
}

/**
 * Run the character's sequence until it names a frame. Returns false if the
 * byte-code ran off the end of the table, which only dead entries do.
 */
export function playSequence(state: CharacterState, ctx: SequenceContext): boolean {
  const code = ctx.tables.sequences;
  const read = (): number => {
    const at = state.currentSequence - SEQUENCE_BASE;
    state.currentSequence = (state.currentSequence + 1) & 0xffff;
    return at >= 0 && at < code.length ? code[at] : 0xff;
  };
  for (let guard = 0; guard < 1000; guard++) {
    const at = state.currentSequence - SEQUENCE_BASE;
    if (at < 0 || at >= code.length) return false;
    const command = read();
    switch (command) {
      case SEQ_OP.dx:
        state.x = u8(forwardX(state, i8(read())));
        break;
      case SEQ_OP.dy:
        state.y = u8(state.y + i8(read()));
        break;
      case SEQ_OP.flip:
        state.direction = ~state.direction;
        break;
      case SEQ_OP.jumpIfFeather:
        if (!ctx.isFeatherFall) {
          read();
          read();
          break;
        }
      // fallthrough: a feather fall takes the jump
      case SEQ_OP.jump: {
        const lo = read();
        const hi = read();
        state.currentSequence = lo | (hi << 8);
        break;
      }
      case SEQ_OP.up:
        state.currentRow -= 1;
        ctx.effects?.rowChanged?.(-1);
        break;
      case SEQ_OP.down:
        state.currentRow += 1;
        ctx.effects?.rowChanged?.(1);
        break;
      case SEQ_OP.action:
        state.action = read();
        break;
      case SEQ_OP.setFall:
        state.fallX = i8(read());
        state.fallY = i8(read());
        break;
      case SEQ_OP.knockUp:
        ctx.effects?.knock?.(1);
        break;
      case SEQ_OP.knockDown:
        ctx.effects?.knock?.(-1);
        break;
      case SEQ_OP.sound:
        ctx.effects?.sound?.(read());
        break;
      case SEQ_OP.endLevel:
        ctx.effects?.endLevel?.();
        break;
      case SEQ_OP.getItem:
        ctx.effects?.getItem?.(read());
        break;
      case SEQ_OP.die:
        ctx.effects?.die?.();
        break;
      default:
        state.frame = command;
        return true;
    }
  }
  throw new Error('sequence did not reach a frame');
}
