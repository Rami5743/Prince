/**
 * Drawing a room, the way the original did it.
 *
 * The original does not paint tiles one at a time. It walks the room from the
 * bottom row up and, for each tile, appends pieces to three lists -- a back
 * list, a middle list and a front list -- then paints the lists in order. The
 * Prince and the guards go into the middle list, so they end up behind the
 * front edges of floors and in front of their backs. Reproducing that
 * structure, rather than inventing a z-order, is what gets the overlaps right.
 *
 * Each tile contributes pieces that belong to its *neighbours*: a floor draws
 * the underside of the tile above it and the left edge of the tile to its
 * right. That is why the loop keeps the tile to the left and the row below in
 * hand while drawing.
 */
import type { SpriteSet } from './assets.ts';
import type { Surface } from './surface.ts';
import {
  TILE, TILE_TABLE, TILE_TYPE_MASK, tileIsFloor,
  ROOM_COLUMNS, WALL_SWS, WALL_SWW, WALL_WWS, WALL_WWW,
} from '../game/tiles.ts';
import { toScreenX } from '../game/geometry.ts';

const flipCache = new WeakMap<object, { width: number; height: number; pixels: Uint8Array }>();

function flipHorizontally(
  img: { width: number; height: number; pixels: Uint8Array },
): { width: number; height: number; pixels: Uint8Array } {
  const cached = flipCache.get(img);
  if (cached) return cached;
  const pixels = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      pixels[y * img.width + (img.width - 1 - x)] = img.pixels[y * img.width + x];
    }
  }
  const out = { width: img.width, height: img.height, pixels };
  flipCache.set(img, out);
  return out;
}

/** Blit modes, with the numbering the original used. */
export const BLIT = {
  opaque: 0,
  or: 2,
  xor: 3,
  black: 9,
  transparent: 0x10,
  mono: 0x40,
  mono12: 0x4c,
  /**
   * The brick edges of a palace wall. The original stamps these masks in one
   * flat colour taken from the wall group's own palette, not from the first
   * sixteen entries; which entry was settled by comparing against the game.
   */
  palaceDecal: 0x100e,
} as const;

export const CHTAB = {
  /** PRINCE.DAT group 700: the sword in the Prince's hand. */
  sword: 'sword',
  /** PRINCE.DAT group 150: torch flames, loose sword, potions, bubbles. */
  flameSwordPotion: 'flameSwordPotion',
  /** KID.DAT group 400: the Prince. */
  kid: 'kid',
  /** The enemy sprite set of the level: a guard, a skeleton, Jaffar. */
  guard: 'guard',
  /** The tile set's group 200. */
  environment: 'environment',
  /** The tile set's group 360. */
  environmentWall: 'environmentWall',
} as const;
export type ChtabId = (typeof CHTAB)[keyof typeof CHTAB];

export interface Chtabs {
  readonly flameSwordPotion: SpriteSet;
  readonly environment: SpriteSet;
  readonly environmentWall: SpriteSet;
  readonly kid?: SpriteSet;
  readonly sword?: SpriteSet;
  readonly guard?: SpriteSet;
}

/**
 * A character ready to be drawn. The original keeps characters in a separate
 * list that is sorted and then merged into the middle draw list, so that they
 * pass behind the front edge of a floor and in front of its back.
 */
/** A falling floor, on its way down. */
export interface MobDraw {
  room: number;
  /** Tile column of the room it is falling through. */
  column: number;
  /** Where its underside has got to, in the same units a tile's bottom is. */
  y: number;
  /** Which row it is passing through; it decides what is drawn over it. */
  row: number;
}

export interface CharacterDraw {
  readonly chtab: ChtabId;
  /** 1-based sprite id within the group. */
  readonly image: number;
  /** Horizontal position in internal units, before the 280-to-320 stretch. */
  readonly x: number;
  /** Bottom row of the sprite, in screen pixels. */
  readonly y: number;
  /** 0 facing right, -1 facing left. Sprites are stored facing left. */
  readonly direction: number;
  /** Which row of the room he is in; it decides what is drawn over him. */
  readonly row?: number;
  /** A sword's x is already in screen pixels and must not be stretched. */
  readonly alreadyScreenX?: boolean;
}

/** The strip of the room above, drawn after every row of this one. */
const ROW_ABOVE_ORDER = -1;

interface Piece {
  chtab: ChtabId;
  /** 1-based image id within the group; 0 means nothing is drawn. */
  id: number;
  x: number;
  yBottom: number;
  blit: number;
  /** Characters have their x stretched from internal units and may be flipped. */
  character?: boolean;
  flip?: boolean;
  /** Set when x is already in screen pixels, as a sword's is. */
  screenX?: boolean;
  /**
   * Which pass of the room drawing put this here. The room is drawn from
   * the bottom row up, so a smaller number is painted later and therefore
   * over the top. See `PAINT_ORDERS`.
   */
  order: number;
}

interface Wipe {
  layer: number;
  left: number;
  bottom: number;
  height: number;
  width: number;
  color: number;
}

export interface RoomTiles {
  /** Tile type of (room, column, row); room 0 means "outside the level". */
  typeAt(room: number, column: number, row: number): number;
  modifierAt(room: number, column: number, row: number): number;
  /** roomLinks[(room-1)*4 + dir], dir 0 left, 1 right, 2 up, 3 down. */
  linkOf(room: number, dir: number): number;
  /**
   * How long a button's link still has to run. A button's modifier is an
   * index into the door links, and the timer there is what says the plate
   * is down -- there is nothing in the tile itself to say so.
   */
  doorLinkTimer?(index: number): number;
}

export interface RoomRenderOptions {
  /** 0 dungeon, 1 palace. */
  levelType: number;
  /** Tile drawn above the top row of the level. */
  topLevelEdgeTile: number;
  /** Tile drawn to the left of column 0. */
  leftLevelEdgeTile: number;
  enableWdaInPalace: boolean;
  /** Room the level starts in; the level door is drawn differently there. */
  startRoom?: number;
  /**
   * The original draws the front of a gate only when the Prince is standing
   * in it, so that he appears behind the bars. Until characters exist this
   * stays unset and no gate front is drawn.
   */
  gateForeAt?: (row: number, column: number) => boolean;
  /** Solid colours the palace wall pattern paints; 132 entries. */
  palaceWallColors?: Uint8Array;
}

const COL_X = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288];

/** Wall-piece image ids within the wall sprite group. */
const WALL_RES = {
  divider1: 11,
  randomBlock: 13,
  markTopLeft: 14,
  markBottomLeft: 15,
  markTopRight: 16,
  markBottomRight: 17,
} as const;

const DOORTOP_FRAM_TOP = [0, 81, 83, 0];
const DOOR_FRAM_TOP = [60, 61, 62, 63, 64, 65, 66, 67];
const BLUELINE_FRAM1 = [0, 124, 125, 126];
const BLUELINE_FRAM_Y = [0, -20, -20, 0];
const BLUELINE_FRAM3 = [44, 44, 45, 45];
const DOORTOP_FRAM_BOT = [78, 80, 82, 0];
const DOOR_FRAM_SLICE = [67, 59, 58, 57, 56, 55, 54, 53, 52];
const SPIKES_FRAM_RIGHT = [0, 134, 135, 136, 137, 138, 137, 135, 134, 0];
const LOOSE_FRAM_RIGHT = [42, 71, 42, 72, 72, 42, 42, 42, 72, 72, 72, 0];
const WALL_FRAM_BOTTOM = [7, 9, 5, 3];
const LOOSE_FRAM_BOTTOM = [43, 73, 43, 74, 74, 43, 43, 43, 74, 74, 74, 0];
const LOOSE_FRAM_LEFT = [41, 69, 41, 70, 70, 41, 41, 41, 70, 70, 70, 0];
const SPIKES_FRAM_LEFT = [0, 128, 129, 130, 131, 132, 131, 129, 128, 0];
const POTION_FRAM_BUBB = [0, 16, 17, 18, 19, 20, 21, 22];
const CHOMPER_FRAM1 = [3, 2, 0, 1, 4, 3, 3, 0];
const CHOMPER_FRAM_BOT = [101, 102, 103, 104, 105, 0];
const CHOMPER_FRAM_TOP = [0, 0, 111, 112, 113, 0];
const CHOMPER_FRAM_Y = [0, 0, 0x25, 0x2f, 0x32];
const SPIKES_FRAM_FORE = [0, 139, 140, 141, 142, 143, 142, 140, 139, 0];
const CHOMPER_FRAM_FOR = [106, 107, 108, 109, 110, 0];
const WALL_FRAM_MAIN = [8, 10, 6, 4];
const LEFT_MARK_Y = [58, 41, 37, 20, 16];
const RIGHT_MARK_Y = [52, 42, 31, 21];

function spikeFrame(modifier: number): number {
  return modifier & 0x80 ? 5 : modifier;
}

function looseFrame(modifier: number): number {
  if (modifier & 0x80) {
    const m = modifier & 0x7f;
    if (m > 10) return 1;
    return m;
  }
  return modifier;
}

/** The original's linear congruential generator, seeded per tile. */
class Prng {
  private seed = 0;

  set(value: number): void {
    this.seed = value >>> 0;
  }

  get(): number {
    return this.seed >>> 0;
  }

  next(max: number): number {
    this.seed = (Math.imul(this.seed, 214013) + 2531011) >>> 0;
    return (this.seed >>> 16) % (max + 1);
  }
}

/**
 * Palace walls are not drawn from tiles at all: the original fills them with
 * flat colour, picking each brick's shade from a generator seeded by the room
 * number, then lays brick-edge decals on top. The same room therefore always
 * comes out the same, while no two rooms look alike.
 *
 * The colours are absolute palette indices in the wall group's block.
 */
export function generatePalaceWallColors(room: number): Uint8Array {
  const out = new Uint8Array(132);
  const prng = new Prng();
  prng.set(room);
  prng.next(1);
  for (let row = 0; row < 3; row++) {
    for (let subrow = 0; subrow < 4; subrow++) {
      const base = subrow % 2 ? 0x61 : 0x66;
      let prev = -1;
      for (let column = 0; column <= 10; column++) {
        let color: number;
        do {
          color = base + prng.next(3);
        } while (color === prev);
        out[44 * row + 11 * subrow + column] = color;
        prev = color;
      }
    }
  }
  return out;
}

export class RoomRenderer {
  private readonly chtabs: Chtabs;
  private readonly tiles: RoomTiles;
  private readonly opt: RoomRenderOptions;

  private back: Piece[] = [];
  private mid: Piece[] = [];
  private fore: Piece[] = [];
  private wipes: Wipe[] = [];
  /** Which list draw_tile_base / draw_tile_bottom append to. */
  private addTo: 'back' | 'fore' = 'back';

  private drawnRoom = 0;
  /** Which pass of the room drawing is running; stamped on every piece. */
  private paintOrder = ROW_ABOVE_ORDER + 1;
  private drawnRow = 0;
  private drawnCol = 0;
  private drawX = 0;
  private drawBottomY = 0;
  private drawMainY = 0;

  private currTile = 0;
  private currModifier = 0;
  private tileLeft = 0;
  private modifierLeft = 0;

  private roomL = 0;
  private roomR = 0;
  private roomA = 0;
  private roomB = 0;
  private roomAL = 0;
  private roomAR = 0;
  private roomBL = 0;
  private roomBR = 0;

  private leftRoomTiles = new Uint8Array(3);
  private leftRoomMods = new Uint8Array(3);
  private rowBelowTiles = new Uint8Array(ROOM_COLUMNS);
  private rowBelowMods = new Uint8Array(ROOM_COLUMNS);

  private readonly prng = new Prng();
  private palaceWallColors: Uint8Array<ArrayBufferLike> = new Uint8Array(132);

  constructor(chtabs: Chtabs, tiles: RoomTiles, opt: RoomRenderOptions) {
    this.chtabs = chtabs;
    this.tiles = tiles;
    this.opt = opt;
  }

  private get isPalace(): boolean {
    return this.opt.levelType !== 0;
  }

  /** Build the draw lists for a room and paint them onto `surface`. */
  render(
    surface: Surface, room: number, characters: readonly CharacterDraw[] = [],
    mobs: readonly MobDraw[] = [],
  ): void {
    this.back = [];
    this.mid = [];
    this.fore = [];
    this.wipes = [];
    this.addTo = 'back';
    this.paintOrder = ROW_ABOVE_ORDER + 1;
    this.drawnRoom = room;
    this.palaceWallColors = this.opt.palaceWallColors ?? generatePalaceWallColors(room);
    this.loadRoomLinks();
    this.drawRoom();
    for (const c of characters) this.addCharacter(c);
    for (const m of mobs) this.addMob(m);
    this.paint(surface);
  }

  // ---------------------------------------------------------------- lists

  private addBack(chtab: ChtabId, id: number, x: number, yBottom: number, blit: number): boolean {
    return this.push(this.back, chtab, id, x, yBottom, blit);
  }

  private addFore(chtab: ChtabId, id: number, x: number, yBottom: number, blit: number): boolean {
    return this.push(this.fore, chtab, id, x, yBottom, blit);
  }

  private addMid(chtab: ChtabId, id: number, x: number, yBottom: number, blit: number): boolean {
    return this.push(this.mid, chtab, id, x, yBottom, blit);
  }

  private addCurrent(chtab: ChtabId, id: number, x: number, yBottom: number, blit: number): boolean {
    return this.addTo === 'back'
      ? this.addBack(chtab, id, x, yBottom, blit)
      : this.addFore(chtab, id, x, yBottom, blit);
  }

  private push(
    list: Piece[], chtab: ChtabId, id: number, x: number, yBottom: number, blit: number,
  ): boolean {
    if (id === 0) return false;
    if (!this.image(chtab, id)) return false;
    list.push({ chtab, id, x, yBottom, blit, order: this.paintOrder });
    return true;
  }

  private addWipe(
    layer: number, left: number, bottom: number, height: number, width: number, color: number,
  ): void {
    this.wipes.push({ layer, left, bottom, height, width, color });
  }

  private image(chtab: ChtabId, id: number) {
    return this.chtabs[chtab]?.images[id] ?? null;
  }

  // ------------------------------------------------------------ room setup

  private loadRoomLinks(): void {
    const room = this.drawnRoom;
    this.roomBR = 0;
    this.roomBL = 0;
    this.roomAR = 0;
    this.roomAL = 0;
    if (!room) {
      this.roomL = this.roomR = this.roomA = this.roomB = 0;
      return;
    }
    this.roomL = this.tiles.linkOf(room, 0);
    this.roomR = this.tiles.linkOf(room, 1);
    this.roomA = this.tiles.linkOf(room, 2);
    this.roomB = this.tiles.linkOf(room, 3);
    if (this.roomA) {
      this.roomAL = this.tiles.linkOf(this.roomA, 0);
      this.roomAR = this.tiles.linkOf(this.roomA, 1);
    } else {
      if (this.roomL) this.roomAL = this.tiles.linkOf(this.roomL, 2);
      if (this.roomR) this.roomAR = this.tiles.linkOf(this.roomR, 2);
    }
    if (this.roomB) {
      this.roomBL = this.tiles.linkOf(this.roomB, 0);
      this.roomBR = this.tiles.linkOf(this.roomB, 1);
    } else {
      if (this.roomL) this.roomBL = this.tiles.linkOf(this.roomL, 3);
      if (this.roomR) this.roomBR = this.tiles.linkOf(this.roomR, 3);
    }
  }

  /**
   * A tile as it should be drawn: buttons that are currently held down show
   * as a different tile, and tiles outside the level show as the level edge.
   */
  private tileToDraw(
    room: number, column: number, row: number, outsideTile: number,
  ): { type: number; modifier: number } {
    let type: number;
    let modifier: number;
    if (column === -1) {
      type = this.leftRoomTiles[row];
      modifier = this.leftRoomMods[row];
    } else if (room) {
      type = this.tiles.typeAt(room, column, row) & TILE_TYPE_MASK;
      modifier = this.tiles.modifierAt(room, column, row);
    } else {
      type = outsideTile;
      modifier = 0;
    }
    return { type, modifier };
  }

  private loadLeftRoom(): void {
    for (let row = 0; row < 3; row++) {
      const t = this.tileToDraw(this.roomL, 9, row, this.opt.leftLevelEdgeTile);
      this.leftRoomTiles[row] = t.type;
      this.leftRoomMods[row] = t.modifier;
    }
  }

  private loadRowBelow(): void {
    let room: number;
    let roomLeft: number;
    let rowBelow: number;
    if (this.drawnRow === 2) {
      room = this.roomB;
      roomLeft = this.roomBL;
      rowBelow = 0;
    } else {
      room = this.drawnRoom;
      roomLeft = this.roomL;
      rowBelow = this.drawnRow + 1;
    }
    for (let column = 1; column < 10; column++) {
      const t = this.tileToDraw(room, column - 1, rowBelow, TILE.empty);
      this.rowBelowTiles[column] = t.type;
      this.rowBelowMods[column] = t.modifier;
    }
    const t0 = this.tileToDraw(roomLeft, 9, rowBelow, TILE.wall);
    this.rowBelowTiles[0] = t0.type;
    this.rowBelowMods[0] = t0.modifier;
  }

  /**
   * A button with a foot on it is drawn as the floor it sits in.
   *
   * Its plate is a pixel of height -- an opener's base is 32x14 where a
   * plain floor's is 32x13, and its right-hand piece sits a pixel higher
   * -- and that pixel is spread over four of the pieces a tile is built
   * from, the tile's own and two that its right-hand neighbour draws.
   * Sinking only some of them leaves the plate half down. Swapping the
   * type here instead puts every piece on the floor's measurements at
   * once.
   *
   * Whether a foot is on it is not in the tile: a button's modifier is an
   * index into the level's door links, and the timer kept there is the
   * record -- `pressButton` sets it to five and `animateButton` counts it
   * down, so it holds while the foot is there and runs out a few ticks
   * after it leaves.
   */
  private pressedToFloor(type: number, modifier: number): number {
    if (type !== TILE.opener && type !== TILE.closer) return type;
    return (this.tiles.doorLinkTimer?.(modifier) ?? 0) > 0 ? TILE.floor : type;
  }

  private loadCurrentAndLeftTile(): void {
    const outside = this.drawnRow === 2 ? this.opt.topLevelEdgeTile : TILE.wall;
    const curr = this.tileToDraw(this.drawnRoom, this.drawnCol, this.drawnRow, outside);
    this.currTile = this.pressedToFloor(curr.type, curr.modifier);
    this.currModifier = curr.modifier;
    const left = this.tileToDraw(this.drawnRoom, this.drawnCol - 1, this.drawnRow, outside);
    this.tileLeft = this.pressedToFloor(left.type, left.modifier);
    this.modifierLeft = left.modifier;
    this.drawX = COL_X[this.drawnCol];
  }

  private drawRoom(): void {
    this.loadLeftRoom();
    for (this.drawnRow = 2; this.drawnRow >= 0; this.drawnRow--) {
      this.paintOrder = this.drawnRow;
      this.loadRowBelow();
      this.drawBottomY = 63 * this.drawnRow + 65;
      this.drawMainY = this.drawBottomY - 3;
      for (this.drawnCol = 0; this.drawnCol < 10; this.drawnCol++) {
        this.loadCurrentAndLeftTile();
        this.drawTile();
      }
    }
    // The bottom row of the room above pokes into the top of this one.
    const saved = this.drawnRoom;
    this.paintOrder = ROW_ABOVE_ORDER;
    this.drawnRoom = this.roomA;
    this.loadRoomLinks();
    this.loadLeftRoom();
    this.drawnRow = 2;
    this.loadRowBelow();
    for (this.drawnCol = 0; this.drawnCol < 10; this.drawnCol++) {
      this.loadCurrentAndLeftTile();
      this.drawMainY = -1;
      this.drawBottomY = 2;
      this.drawTileAboveRoom();
    }
    this.drawnRoom = saved;
    this.loadRoomLinks();
  }

  private drawTile(): void {
    this.drawTileFloorRight();
    this.drawTileAnimTopRight();
    this.drawTileRight();
    this.drawTileAnimRight();
    this.drawTileBottom();
    this.drawLoose();
    this.drawTileBase();
    this.drawTileAnim();
    this.drawTileFore();
  }

  private drawTileAboveRoom(): void {
    this.drawTileFloorRight();
    this.drawTileAnimTopRight();
    this.drawTileRight();
    this.drawTileBottom();
    this.drawLoose();
    this.drawTileFore();
  }

  // ---------------------------------------------------------------- passes

  private canSeeBottomLeft(): boolean {
    return this.currTile === TILE.empty
      || this.currTile === TILE.bigPillarTop
      || this.currTile === TILE.doortop
      || this.currTile === TILE.latticeDown;
  }

  private drawTileFloorRight(): void {
    if (!this.canSeeBottomLeft()) return;
    this.drawTileTopRight();
    if (TILE_TABLE[this.tileLeft].floorRight === 0) return;
    this.addBack(
      CHTAB.environment, 42,
      this.drawX, TILE_TABLE[TILE.floor].rightY + this.drawMainY, BLIT.black,
    );
  }

  private drawTileTopRight(): void {
    const type = this.rowBelowTiles[this.drawnCol];
    const modifier = this.rowBelowMods[this.drawnCol];
    if (type === TILE.doortopWithFloor || type === TILE.doortop) {
      if (!this.isPalace) return;
      this.addBack(
        CHTAB.environment, DOORTOP_FRAM_TOP[modifier] ?? 0,
        this.drawX, this.drawBottomY, BLIT.or,
      );
    } else if (type === TILE.wall) {
      this.addBack(CHTAB.environmentWall, 2, this.drawX, this.drawBottomY, BLIT.or);
    } else {
      this.addBack(
        CHTAB.environment, TILE_TABLE[type].topRightId,
        this.drawX, this.drawBottomY, BLIT.or,
      );
    }
  }

  private drawTileAnimTopRight(): void {
    const seeThrough = this.currTile === TILE.empty
      || this.currTile === TILE.bigPillarTop
      || this.currTile === TILE.doortop;
    if (!seeThrough || this.rowBelowTiles[this.drawnCol] !== TILE.gate) return;
    this.addBack(CHTAB.environment, 68, this.drawX, this.drawBottomY, BLIT.mono);
    let modifier = this.rowBelowMods[this.drawnCol];
    if (modifier > 188) modifier = 188;
    this.addBack(
      CHTAB.environment, DOOR_FRAM_TOP[(modifier >> 2) % 8],
      this.drawX, this.drawBottomY, BLIT.or,
    );
  }

  private drawTileRight(): void {
    if (this.currTile === TILE.wall) return;
    const left = this.tileLeft;
    switch (left) {
      case TILE.empty: {
        if (this.modifierLeft > 3) return;
        this.addBack(
          CHTAB.environment, BLUELINE_FRAM1[this.modifierLeft],
          this.drawX, BLUELINE_FRAM_Y[this.modifierLeft] + this.drawMainY, BLIT.or,
        );
        break;
      }
      case TILE.floor: {
        this.addCurrent(
          CHTAB.environment, 42,
          this.drawX, TILE_TABLE[left].rightY + this.drawMainY, BLIT.transparent,
        );
        let num = this.modifierLeft;
        if (num > 3) num = 0;
        if (num === (this.isPalace ? 1 : 0)) return;
        this.addBack(
          CHTAB.environment, BLUELINE_FRAM3[num],
          this.drawX, this.drawMainY - 20, BLIT.opaque,
        );
        break;
      }
      case TILE.doortopWithFloor:
      case TILE.doortop: {
        if (!this.isPalace) return;
        this.addBack(
          CHTAB.environment, DOORTOP_FRAM_BOT[this.modifierLeft] ?? 0,
          this.drawX, TILE_TABLE[left].rightY + this.drawMainY, BLIT.or,
        );
        break;
      }
      case TILE.wall: {
        if (this.isPalace && (this.modifierLeft & 0x80) === 0) {
          this.addBack(
            CHTAB.environment, 84,
            this.drawX + 24, this.drawMainY - 27, BLIT.opaque,
          );
        }
        this.addBack(
          CHTAB.environmentWall, 1,
          this.drawX, TILE_TABLE[left].rightY + this.drawMainY, BLIT.or,
        );
        break;
      }
      default: {
        let id = TILE_TABLE[left].rightId;
        if (id) {
          let blit: number = BLIT.or;
          if (left === TILE.stuck) {
            blit = BLIT.transparent;
            if (this.currTile === TILE.empty || this.currTile === TILE.stuck
              || !tileIsFloor(this.currTile)) {
              id = 42;
            }
          }
          this.addBack(
            CHTAB.environment, id,
            this.drawX, TILE_TABLE[left].rightY + this.drawMainY, blit,
          );
        }
        if (this.isPalace) {
          this.addBack(
            CHTAB.environment, TILE_TABLE[left].stripeId,
            this.drawX, this.drawMainY - 27, BLIT.or,
          );
        }
        if (left === TILE.torch || left === TILE.torchWithDebris) {
          this.addBack(
            CHTAB.environment, 146,
            this.drawX, this.drawBottomY - 28, BLIT.opaque,
          );
        }
        break;
      }
    }
  }

  private drawTileAnimRight(): void {
    switch (this.tileLeft) {
      case TILE.spike:
        this.addBack(
          CHTAB.environment, SPIKES_FRAM_RIGHT[spikeFrame(this.modifierLeft)] ?? 0,
          this.drawX, this.drawMainY - 7, BLIT.transparent,
        );
        break;
      case TILE.gate:
        this.drawGateBack();
        break;
      case TILE.loose:
        this.addBack(
          CHTAB.environment, LOOSE_FRAM_RIGHT[looseFrame(this.modifierLeft)] ?? 0,
          this.drawX, this.drawBottomY - 1, BLIT.or,
        );
        break;
      case TILE.levelDoorLeft:
        this.drawLevelDoor();
        break;
      case TILE.torch:
      case TILE.torchWithDebris:
        // Images 1..9 are the flame frames; the tile's modifier is the
        // frame. The original picks it at random when the room is entered
        // and mostly advances it by one per tick, so two torches side by
        // side are rarely in step.
        if (this.modifierLeft < 9) {
          this.addBack(
            CHTAB.flameSwordPotion, this.modifierLeft + 1,
            this.drawX + 8, this.drawMainY - 40, BLIT.opaque,
          );
        }
        break;
      default:
        break;
    }
  }

  private drawTileBottom(): void {
    let id = 0;
    let blit: number = BLIT.opaque;
    let chtab: ChtabId = CHTAB.environment;
    if (this.currTile === TILE.wall) {
      if (!this.isPalace || this.opt.enableWdaInPalace) {
        id = WALL_FRAM_BOTTOM[this.currModifier & 0x7f] ?? 0;
      }
      chtab = CHTAB.environmentWall;
    } else {
      if (this.currTile === TILE.doortop) blit = BLIT.or;
      id = TILE_TABLE[this.currTile].bottomId;
    }
    this.addCurrent(chtab, id, this.drawX, this.drawBottomY, blit);
    if (chtab === CHTAB.environmentWall) this.wallPattern(0, 0);
  }

  private drawLoose(): void {
    if (this.currTile !== TILE.loose) return;
    const id = LOOSE_FRAM_BOTTOM[looseFrame(this.currModifier)] ?? 0;
    this.addBack(CHTAB.environment, id, this.drawX, this.drawBottomY, BLIT.opaque);
    this.addFore(CHTAB.environment, id, this.drawX, this.drawBottomY, BLIT.opaque);
  }

  private drawTileBase(): void {
    let id: number;
    let yBottom = this.drawMainY;
    if (this.tileLeft === TILE.latticeDown && this.currTile === TILE.doortop) {
      id = 6;
      yBottom += 3;
    } else if (this.currTile === TILE.loose) {
      id = LOOSE_FRAM_LEFT[looseFrame(this.currModifier)] ?? 0;
    } else if (this.currTile === TILE.opener && this.tileLeft === TILE.empty && !this.isPalace) {
      id = 148;
    } else {
      id = TILE_TABLE[this.currTile].baseId;
    }
    this.addCurrent(
      CHTAB.environment, id,
      this.drawX, TILE_TABLE[this.currTile].baseY + yBottom, BLIT.transparent,
    );
  }

  private drawTileAnim(): void {
    switch (this.currTile) {
      case TILE.spike:
        this.addCurrent(
          CHTAB.environment, SPIKES_FRAM_LEFT[spikeFrame(this.currModifier)] ?? 0,
          this.drawX, this.drawMainY - 2, BLIT.transparent,
        );
        break;
      case TILE.potion: {
        let potSize = 0;
        let color = 12;
        switch ((this.currModifier & 0xf8) >> 3) {
          case 0: return;
          case 5:
          case 6: color = 9; break;
          case 3:
          case 4: color = 10; potSize = 1; break;
          case 2: potSize = 1; break;
          default: break;
        }
        const y = this.drawMainY - (potSize << 2) - 14;
        this.addBack(CHTAB.flameSwordPotion, 23, this.drawX + 25, y, BLIT.mono);
        this.addFore(
          CHTAB.flameSwordPotion, POTION_FRAM_BUBB[this.currModifier & 7],
          this.drawX + 25, y, color + BLIT.mono,
        );
        break;
      }
      case TILE.sword:
        this.addMid(
          CHTAB.flameSwordPotion, (this.currModifier === 1 ? 1 : 0) + 10,
          this.drawX, this.drawMainY - 3, BLIT.transparent,
        );
        break;
      case TILE.chomper: {
        const n = CHOMPER_FRAM1[Math.min(this.currModifier & 0x7f, 6)];
        this.addBack(
          CHTAB.environment, CHOMPER_FRAM_BOT[n] ?? 0,
          this.drawX, this.drawMainY, BLIT.transparent,
        );
        if (this.currModifier & 0x80) {
          this.addBack(
            CHTAB.environment, n + 114,
            this.drawX + 12, this.drawMainY - 6, BLIT.mono12,
          );
        }
        this.addBack(
          CHTAB.environment, CHOMPER_FRAM_TOP[n] ?? 0,
          this.drawX, this.drawMainY - (CHOMPER_FRAM_Y[n] ?? 0), BLIT.transparent,
        );
        break;
      }
      default:
        break;
    }
  }

  private drawTileFore(): void {
    if (this.tileLeft === TILE.gate && this.opt.gateForeAt
      && this.opt.gateForeAt(this.drawnRow, this.drawnCol - 1)) {
      this.drawGateFore();
    }
    switch (this.currTile) {
      case TILE.spike:
        this.addFore(
          CHTAB.environment, SPIKES_FRAM_FORE[spikeFrame(this.currModifier)] ?? 0,
          this.drawX, this.drawMainY - 2, BLIT.transparent,
        );
        return;
      case TILE.chomper: {
        const n = CHOMPER_FRAM1[Math.min(this.currModifier & 0x7f, 6)];
        this.addFore(
          CHTAB.environment, CHOMPER_FRAM_FOR[n] ?? 0,
          this.drawX, this.drawMainY, BLIT.transparent,
        );
        if (this.currModifier & 0x80) {
          this.addFore(
            CHTAB.environment, n + 119,
            this.drawX + 12, this.drawMainY - 6, BLIT.mono12,
          );
        }
        return;
      }
      case TILE.wall:
        if (!this.isPalace || this.opt.enableWdaInPalace) {
          this.addFore(
            CHTAB.environmentWall, WALL_FRAM_MAIN[this.currModifier & 0x7f] ?? 0,
            this.drawX, this.drawMainY, BLIT.opaque,
          );
        }
        this.wallPattern(1, 1);
        return;
      default: {
        const table = TILE_TABLE[this.currTile];
        let id = table.foreId;
        if (id === 0) return;
        if (this.currTile === TILE.potion) {
          const potionType = (this.currModifier & 0xf8) >> 3;
          if (potionType < 5 && potionType >= 2) id = 13;
        }
        const x = table.foreX * 8 + this.drawX;
        const yBottom = table.foreY + this.drawMainY;
        if (this.currTile === TILE.potion) {
          if (this.isPalace) id += 2;
          this.addFore(CHTAB.flameSwordPotion, id, x + 6, yBottom, BLIT.transparent);
        } else if (
          (this.currTile === TILE.pillar && !this.isPalace)
          || (this.currTile >= TILE.latticeSmall && this.currTile < TILE.torchWithDebris)
        ) {
          this.addFore(CHTAB.environment, id, x, yBottom, BLIT.opaque);
        } else {
          this.addFore(CHTAB.environment, id, x, yBottom, BLIT.transparent);
        }
        return;
      }
    }
  }

  // ------------------------------------------------------------ gates

  private gateTopY = 0;
  private gateOpenness = 0;
  private gateBottomY = 0;
  /** Right edge of the level door, needed by the game logic later. */
  levelDoorRight = 0;
  levelDoorYBottom = 0;

  private calcGatePos(): void {
    this.gateTopY = this.drawBottomY - 62;
    this.gateOpenness = (Math.min(this.modifierLeft, 188) >> 2) + 1;
    this.gateBottomY = this.drawMainY - this.gateOpenness;
  }

  private drawGateBack(): void {
    this.calcGatePos();
    if (this.gateBottomY + 12 < this.drawMainY) {
      this.addBack(CHTAB.environment, 50, this.drawX, this.gateBottomY, BLIT.opaque);
    } else {
      // The original redraws a few pieces here; it erases part of the tile
      // below-left and then patches it up. Keeping the same sequence keeps
      // the same result, quirk included.
      this.addBack(
        CHTAB.environment, TILE_TABLE[TILE.gate].rightId,
        this.drawX, TILE_TABLE[TILE.gate].rightY + this.drawMainY, BLIT.opaque,
      );
      if (this.canSeeBottomLeft()) this.drawTileTopRight();
      this.drawTileBottom();
      this.drawLoose();
      this.drawTileBase();
      this.addBack(CHTAB.environment, 51, this.drawX, this.gateBottomY - 2, BLIT.transparent);
    }
    let yBottom = this.gateBottomY - 12;
    if (yBottom < 192) {
      for (; yBottom >= 0 && yBottom > 7 && yBottom - 7 > this.gateTopY; yBottom -= 8) {
        this.addBack(CHTAB.environment, 52, this.drawX, yBottom, BLIT.opaque);
      }
    }
    const frame = (yBottom - this.gateTopY + 1) & 0xffff;
    if (frame > 0 && frame < 9) {
      this.addBack(CHTAB.environment, DOOR_FRAM_SLICE[frame], this.drawX, yBottom, BLIT.opaque);
    }
  }

  private drawGateFore(): void {
    this.calcGatePos();
    this.addFore(CHTAB.environment, 51, this.drawX, this.gateBottomY - 2, BLIT.transparent);
    let yBottom = this.gateBottomY - 12;
    if (yBottom < 192) {
      for (; yBottom >= 0 && yBottom > 7 && yBottom - 7 > this.gateTopY; yBottom -= 8) {
        this.addFore(CHTAB.environment, 52, this.drawX, yBottom, BLIT.transparent);
      }
    }
  }

  private drawLevelDoor(): void {
    const yBottom = this.drawMainY - 13;
    this.levelDoorRight = this.drawX + 48 + (this.isPalace ? 8 : 0);
    this.addBack(CHTAB.environment, 99, this.drawX + 8, yBottom, BLIT.opaque);
    if (this.modifierLeft) {
      if (this.opt.startRoom !== this.drawnRoom) {
        this.addBack(CHTAB.environment, 144, this.drawX + 8, yBottom - 4, BLIT.opaque);
      } else {
        const width = this.isPalace ? 48 : 39;
        const xLow = this.isPalace ? 0 : 2;
        this.addWipe(0, this.drawX + 8 + xLow, yBottom - 4, 45, width, 0);
      }
    }
    this.levelDoorYBottom = yBottom - (this.modifierLeft & 3) - 48;
    const y = yBottom - this.modifierLeft;
    for (;;) {
      this.addBack(CHTAB.environment, 33, this.drawX + 8, this.levelDoorYBottom, BLIT.opaque);
      if (y > this.levelDoorYBottom) this.levelDoorYBottom += 4;
      else break;
    }
    this.addBack(CHTAB.environment, 34, this.drawX + 8, this.drawMainY - 64, BLIT.opaque);
  }

  // ------------------------------------------------------------- wall look

  /**
   * Dungeon walls are not a repeated tile: the original decorates each one
   * with brick dividers and chipped marks drawn from a generator seeded by
   * the tile's own position, so the wall looks irregular but is identical
   * every time the room is drawn.
   */
  private wallPattern(whichPart: number, whichTable: number): void {
    const savedAddTo = this.addTo;
    this.addTo = whichTable === 0 ? 'back' : 'fore';
    const savedSeed = this.prng.get();
    this.prng.set((this.drawnRoom + this.drawnRow * 10 + this.drawnCol) >>> 0);
    this.prng.next(1);

    const isDungeon = !this.isPalace || this.opt.enableWdaInPalace;
    if (!isDungeon) {
      this.palaceWallPattern(whichPart, whichTable);
    } else {
      // Four draws from the generator, always in this order, so that the
      // same tile looks the same every time it is drawn.
      const middleDivider = this.prng.next(1);
      const middleOffset = this.prng.next(4);
      const bottomDivider = this.prng.next(1);
      const bottomOffset = this.prng.next(4);
      const mod = this.currModifier & 0x7f;

      const randomBlock = () => {
        if (this.prng.next(4) === 0) {
          this.addCurrent(
            CHTAB.environmentWall, WALL_RES.randomBlock,
            this.drawX, this.drawBottomY - 42, BLIT.opaque,
          );
        }
      };
      const middle = () => this.addCurrent(
        CHTAB.environmentWall, WALL_RES.divider1 + middleDivider,
        this.drawX + 8 + middleOffset, this.drawBottomY - 21, BLIT.transparent,
      );
      const bottom = () => this.addCurrent(
        CHTAB.environmentWall, WALL_RES.divider1 + bottomDivider,
        this.drawX + bottomOffset, this.drawBottomY, BLIT.transparent,
      );
      const left = (variant: number) => this.leftMark(
        variant, middleOffset - middleDivider, bottomOffset - bottomDivider,
      );

      switch (mod) {
        case WALL_WWW:
          if (whichPart !== 0) {
            randomBlock();
            middle();
          }
          bottom();
          if (whichPart !== 0) {
            if (this.prng.next(4) === 0) this.rightMark(this.prng.next(3), middleOffset);
            if (this.prng.next(4) === 0) left(this.prng.next(4));
          }
          break;
        case WALL_SWS:
          if (whichPart !== 0 && this.prng.next(6) === 0) left(this.prng.next(1));
          break;
        case WALL_SWW:
          // No bottom divider: there is no wall to the left to meet.
          if (whichPart !== 0) {
            randomBlock();
            middle();
            if (this.prng.next(4) === 0) this.rightMark(this.prng.next(3), middleOffset);
            if (this.prng.next(4) === 0) left(this.prng.next(3));
          }
          break;
        case WALL_WWS:
          if (whichPart !== 0) middle();
          bottom();
          if (whichPart !== 0) {
            if (this.prng.next(4) === 0) this.rightMark(this.prng.next(1) + 2, middleOffset);
            if (this.prng.next(4) === 0) left(this.prng.next(4));
          }
          break;
        default:
          break;
      }
    }

    this.prng.set(savedSeed);
    this.addTo = savedAddTo;
  }

  private palaceWallPattern(whichPart: number, whichTable: number): void {
    const at = (i: number) => this.palaceWallColors[i];
    if (whichPart) {
      this.addWipe(whichTable, this.drawX, this.drawMainY - 40, 20, 32, at(44 * this.drawnRow + this.drawnCol));
      this.addWipe(whichTable, this.drawX, this.drawMainY - 19, 21, 16, at(44 * this.drawnRow + 11 + this.drawnCol));
      this.addWipe(whichTable, this.drawX + 16, this.drawMainY - 19, 21, 16, at(44 * this.drawnRow + 12 + this.drawnCol));
      this.addWipe(whichTable, this.drawX, this.drawMainY, 19, 8, at(44 * this.drawnRow + 22 + this.drawnCol));
      this.addWipe(whichTable, this.drawX + 8, this.drawMainY, 19, 24, at(44 * this.drawnRow + 23 + this.drawnCol));
      this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 3, this.drawX + 24, this.drawMainY - 53, BLIT.palaceDecal);
      this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 6, this.drawX, this.drawMainY - 34, BLIT.palaceDecal);
      this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 9, this.drawX, this.drawMainY - 13, BLIT.palaceDecal);
      this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 12, this.drawX, this.drawMainY, BLIT.palaceDecal);
    }
    this.addWipe(whichTable, this.drawX, this.drawBottomY, 3, 32, at(44 * this.drawnRow + 33 + this.drawnCol));
    this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 15, this.drawX, this.drawBottomY, BLIT.palaceDecal);
  }

  private leftMark(variant: number, arg2: number, arg1: number): void {
    const id = variant % 2 ? WALL_RES.markBottomLeft : WALL_RES.markTopLeft;
    let xl = 0;
    if (variant > 3) xl = arg1 + 6;
    else if (variant > 1) xl = arg2 + 6;
    const xh = this.drawX + (variant === 2 || variant === 3 ? 8 : 0);
    this.addCurrent(
      CHTAB.environmentWall, id, xh + xl,
      this.drawBottomY - LEFT_MARK_Y[variant], BLIT.transparent,
    );
  }

  private rightMark(variant: number, arg1: number): void {
    const id = variant % 2 ? WALL_RES.markBottomRight : WALL_RES.markTopRight;
    const xl = variant < 2 ? 24 : arg1 - 3;
    const xh = this.drawX + (variant > 1 ? 8 : 0);
    this.addCurrent(
      CHTAB.environmentWall, id, xh + xl,
      this.drawBottomY - RIGHT_MARK_Y[variant], BLIT.transparent,
    );
  }

  // ---------------------------------------------------------------- paint

  /**
   * Characters are flipped rather than mirrored in the data: the sprites face
   * left, and the original flips them when the character faces right. Their
   * horizontal position is in internal units and is stretched to pixels only
   * here, at the last moment, exactly as the original does.
   */
  /**
   * A floor that has come away and is on its way down.
   *
   * It is drawn out of the same three pieces a floor tile is -- the base,
   * the right-hand half that belongs to the next column along, and the
   * underside -- but at the height the falling block has reached rather
   * than at its row's. Until this existed nothing drew them at all: the
   * tile was taken out of the room the moment it gave way and the block
   * simply vanished instead of falling.
   */
  private addMob(m: MobDraw): void {
    if (m.room !== this.drawnRoom) return;
    // The column is the column: `COL_X` is indexed the same way the tile
    // loop indexes it. The +1 that used to be here put the falling floor
    // one tile to the right of the hole it came out of, which usually
    // means inside a wall, so it was never seen at all.
    const col = m.column;
    if (col < 0 || col >= COL_X.length) return;
    const x = COL_X[col];
    const main = m.y - 3;
    const floor = TILE_TABLE[TILE.floor];
    const order = m.row;
    this.mid.push({
      chtab: CHTAB.environment, id: LOOSE_FRAM_BOTTOM[0], x, yBottom: m.y,
      blit: BLIT.opaque, order,
    });
    this.mid.push({
      chtab: CHTAB.environment, id: LOOSE_FRAM_LEFT[0], x,
      yBottom: floor.baseY + main, blit: BLIT.transparent, order,
    });
    if (col + 1 < COL_X.length) {
      this.mid.push({
        chtab: CHTAB.environment, id: LOOSE_FRAM_RIGHT[0], x: COL_X[col + 1],
        yBottom: floor.rightY + main, blit: BLIT.transparent, order,
      });
    }
  }

  private addCharacter(c: CharacterDraw): void {
    const set = this.chtabs[c.chtab];
    if (!set) return;
    const img = set.images[c.image];
    if (!img) return;
    this.mid.push({
      chtab: c.chtab,
      id: c.image,
      x: c.x,
      yBottom: c.y,
      blit: BLIT.transparent,
      character: true,
      flip: c.direction === 0,
      screenX: c.alreadyScreenX === true,
      order: c.row ?? 0,
    });
  }

  /**
   * Every piece of the room, then everyone standing in it, then the few
   * pieces the original keeps in front of them.
   *
   * It was worth trying to put each character in with his own row and
   * paint the rows from the bottom up, because the original does cover a
   * climbing Prince with the ledge he is taking hold of, and that bought
   * three captures across the sessions. It is not how the original does
   * it, and the cost showed at a room's edge: a Prince hanging in the
   * bottom row was painted over by everything in the row above, so a
   * climb at the left of a room showed a sliver of him and nothing else.
   * A recording of that climb, replayed against the original, settles
   * it -- painted this way the two agree on the exact pixel count of him
   * for every frame of the climb, and row by row they do not.
   */
  private paint(surface: Surface): void {
    this.paintWipes(surface, 0);
    for (const p of this.back) this.paintPiece(surface, p);
    for (const p of this.mid) this.paintPiece(surface, p);
    this.paintWipes(surface, 1);
    for (const p of this.fore) this.paintPiece(surface, p);
  }

  private paintWipes(surface: Surface, layer: number): void {
    for (const w of this.wipes) {
      if (w.layer !== layer) continue;
      // Like every image here, a wipe is anchored at its bottom row and
      // covers `height` rows ending there, inclusive.
      for (let y = w.bottom - w.height + 1; y <= w.bottom; y++) {
        if (y < 0 || y >= surface.height) continue;
        for (let x = w.left; x < w.left + w.width; x++) {
          if (x < 0 || x >= surface.width) continue;
          surface.pixels[y * surface.width + x] = w.color;
        }
      }
    }
  }

  private paintPiece(surface: Surface, p: Piece): void {
    const img = this.image(p.chtab, p.id);
    if (!img) return;
    const set = this.chtabs[p.chtab];
    if (!set) return;
    const y = p.yBottom - img.height + 1;
    const base = set.paletteBase;
    if (p.character) {
      let x = p.screenX ? p.x : toScreenX(p.x);
      let sprite: { width: number; height: number; pixels: Uint8Array } = img;
      if (p.flip) {
        x -= img.width;
        sprite = flipHorizontally(img);
      }
      surface.blitTransparent(sprite, x, y, base);
      return;
    }
    const blit = p.blit;
    if (blit === BLIT.opaque) {
      surface.blitOpaque(img, p.x, y, base);
    } else if (blit === BLIT.or || blit === BLIT.transparent) {
      surface.blitTransparent(img, p.x, y, base);
    } else if (blit === BLIT.xor) {
      surface.blitXor(img, p.x, y, base);
    } else if (blit === BLIT.black) {
      // "black" stamps the sprite's shape in palette entry 0.
      surface.blitMono(img, p.x, y, 0);
    } else if (blit >= 0x1000) {
      // Mono, but with the colour index read inside the sprite group's own
      // block of the palette.
      surface.blitMono(img, p.x, y, base + (blit & 0xf));
    } else {
      // A "mono" blit stamps the sprite's shape in one flat colour, taken
      // from the first sixteen palette entries.
      surface.blitMono(img, p.x, y, blit & 0xbf);
    }
  }
}

