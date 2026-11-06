/**
 * The level as it is right now, rather than as it shipped.
 *
 * Tiles change while a level is played: a loose floor falls and leaves an
 * empty space, a gate opens, a button stays pressed. Everything that reads
 * tiles -- the renderer, the physics, the traps -- reads them from here, so
 * there is one copy of the truth and it is the one that changes.
 */
import type { Level } from '../dat/level.ts';
import { TILE_TYPE_MASK, ROOM_COLUMNS, alterModifiers } from './tiles.ts';

export class LevelState {
  /** Tile codes, room-major, as the level data lays them out. */
  readonly fg: Uint8Array;
  /** Modifier bytes, rewritten on load the way the original rewrites them. */
  readonly modifiers: Uint8Array;
  readonly roomLinks: Uint8Array;
  readonly doorLinks1: Uint8Array;
  readonly doorLinks2: Uint8Array;
  readonly startRoom: number;
  readonly startPos: number;
  readonly startDir: number;

  constructor(level: Level) {
    this.fg = level.fg.slice();
    this.modifiers = alterModifiers(level.fg, level.bg, level.roomLinks, 24);
    this.roomLinks = level.roomLinks.slice();
    this.doorLinks1 = level.doorLinks1.slice();
    this.doorLinks2 = level.doorLinks2.slice();
    this.startRoom = level.startRoom;
    this.startPos = level.startPos;
    this.startDir = level.startDir;
  }

  private index(room: number, column: number, row: number): number {
    return (room - 1) * 30 + row * ROOM_COLUMNS + column;
  }

  inRoom(room: number, column: number, row: number): boolean {
    return room >= 1 && room <= 24 && column >= 0 && column < ROOM_COLUMNS
      && row >= 0 && row < 3;
  }

  /** The tile's type, with the modifier bits masked off. */
  typeAt(room: number, column: number, row: number): number {
    if (!this.inRoom(room, column, row)) return 0;
    return this.fg[this.index(room, column, row)] & TILE_TYPE_MASK;
  }

  /** The raw tile byte, type and flags together. */
  rawAt(room: number, column: number, row: number): number {
    if (!this.inRoom(room, column, row)) return 0;
    return this.fg[this.index(room, column, row)];
  }

  setType(room: number, column: number, row: number, type: number): void {
    if (!this.inRoom(room, column, row)) return;
    this.fg[this.index(room, column, row)] = type;
  }

  modifierAt(room: number, column: number, row: number): number {
    if (!this.inRoom(room, column, row)) return 0;
    return this.modifiers[this.index(room, column, row)];
  }

  setModifier(room: number, column: number, row: number, value: number): void {
    if (!this.inRoom(room, column, row)) return;
    this.modifiers[this.index(room, column, row)] = value & 0xff;
  }

  /** By tile position within a room: 0..29, counting across then down. */
  typeAtPos(room: number, tilePos: number): number {
    return this.typeAt(room, tilePos % 10, Math.floor(tilePos / 10));
  }

  rawAtPos(room: number, tilePos: number): number {
    return this.rawAt(room, tilePos % 10, Math.floor(tilePos / 10));
  }

  setTypeAtPos(room: number, tilePos: number, type: number): void {
    this.setType(room, tilePos % 10, Math.floor(tilePos / 10), type);
  }

  modifierAtPos(room: number, tilePos: number): number {
    return this.modifierAt(room, tilePos % 10, Math.floor(tilePos / 10));
  }

  setModifierAtPos(room: number, tilePos: number, value: number): void {
    this.setModifier(room, tilePos % 10, Math.floor(tilePos / 10), value);
  }

  linkOf(room: number, dir: number): number {
    if (room < 1 || room > 24) return 0;
    return this.roomLinks[(room - 1) * 4 + dir];
  }

  /**
   * A door link entry: which tile in which room a button is wired to, and
   * whether another entry follows. The room number is split across the two
   * arrays, which is why it is assembled rather than read.
   */
  doorLink(index: number): { room: number; tilePos: number; hasNext: boolean } {
    const a = this.doorLinks1[index] ?? 0;
    const b = this.doorLinks2[index] ?? 0;
    return {
      room: ((a & 0x60) >> 5) + ((b & 0xe0) >> 3),
      tilePos: a & 0x1f,
      hasNext: (a & 0x80) === 0,
    };
  }

  doorLinkTimer(index: number): number {
    return (this.doorLinks2[index] ?? 0) & 0x1f;
  }

  setDoorLinkTimer(index: number, value: number): void {
    if (index < 0 || index >= this.doorLinks2.length) return;
    this.doorLinks2[index] = (this.doorLinks2[index] & 0xe0) | (value & 0x1f);
  }
}
