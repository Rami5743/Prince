/**
 * A character's state, and how it becomes something to draw.
 *
 * The original keeps a character as a position in internal units, a facing
 * direction and a frame number. The frame table turns that number into a
 * sprite and a pair of offsets; the offsets are applied in the direction the
 * character faces, which is why a single table serves both ways round.
 */
import type { Frame } from './exe-tables.ts';
import type { CharacterDraw, ChtabId } from '../render/room.ts';

export const DIRECTION = {
  right: 0,
  left: -1,
} as const;

export const CHAR_ID = {
  kid: 0,
  shadow: 1,
  guard: 2,
  skeleton: 4,
  princess: 5,
  vizier: 6,
  mouse: 24,
} as const;

export interface CharacterState {
  /** Internal x; 14 units to a tile, doubled when it reaches the screen. */
  x: number;
  /** Internal y; the floor heights are in `Y_LAND`. */
  y: number;
  /** 0 facing right, -1 facing left. */
  direction: number;
  /** Index into the character's frame table. */
  frame: number;
  room: number;
  currentColumn: number;
  currentRow: number;
  charId: number;
  /** Address of the next byte-code instruction, in the original's numbering. */
  currentSequence: number;
  /** What the character is doing, as the sequences label it. */
  action: number;
  fallX: number;
  fallY: number;
  /** -1 alive, 0 or more while dying. */
  alive: number;
  sword: number;
  repeat: number;
  /** Counts down after grabbing a ledge, before a climb is allowed. */
  grabTimer: number;
}

/** A character standing still at a given spot, before any sequence runs. */
export function newCharacter(partial: Partial<CharacterState> = {}): CharacterState {
  return {
    x: 0, y: 0, direction: DIRECTION.left, frame: 0,
    room: 1, currentColumn: 0, currentRow: 0, charId: CHAR_ID.kid,
    currentSequence: 0, action: 0, fallX: 0, fallY: 0,
    alive: -1, sword: 0, repeat: 0, grabTimer: 0,
    ...partial,
  };
}

/** Apply a frame's forward offset in the direction the character faces. */
export function forwardX(state: CharacterState, deltaX: number): number {
  return state.x + (state.direction < 0 ? -deltaX : deltaX);
}

/**
 * Turn a character and its frame into a draw request.
 *
 * `x` ends up doubled and shifted by 116: a character's own coordinates
 * count half-tiles from the left of a five-room span, while the renderer
 * works in the 280 units that stretch across the screen.
 */
export function placeCharacter(
  state: CharacterState,
  frame: Frame,
  chtab: ChtabId = 'kid',
): CharacterDraw | null {
  if (frame.image === 255) return null;
  let x = (forwardX(state, frame.dx) << 1) - 116;
  // The low bit selects which of the two pixel columns the sprite starts on,
  // and it depends on the facing as well as on the frame.
  if ((((frame.flags ^ state.direction) << 24) >> 24) >= 0) x += 1;
  return {
    chtab,
    image: frame.image + 1,
    x,
    y: frame.dy + state.y,
    direction: state.direction,
  };
}

/** The frame a character stands still in. */
export const FRAME_STAND = 15;

/**
 * The sword in a character's hand, if the frame shows one.
 *
 * Unlike the character itself, the sword is positioned in screen pixels: the
 * original converts the character's x first and then applies the sword's own
 * offset, so the sword does not get stretched along with everything else.
 */
export function placeSword(
  state: CharacterState,
  frame: Frame,
  swordTable: readonly { id: number; x: number; y: number }[],
  toScreenX: (x: number) => number,
): CharacterDraw | null {
  const index = frame.sword & 0x3f;
  if (!index) return null;
  const placement = swordTable[index];
  if (!placement || placement.id === 255) return null;
  const base = placeCharacter(state, frame);
  if (!base) return null;
  const dx = state.direction < 0 ? -placement.x : placement.x;
  return {
    chtab: 'sword',
    image: placement.id + 1,
    x: toScreenX(base.x) + dx,
    y: base.y + placement.y,
    direction: state.direction,
    alreadyScreenX: true,
  };
}
