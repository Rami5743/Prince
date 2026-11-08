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

/**
 * `redraw_at_char2`: the parts of the room that go back over a
 * character after he has been drawn.
 *
 * The original redraws only the tiles it has to, and a character who
 * is falling, hanging or climbing marks the tiles his box covers.
 * `redraw_needed` then draws those tiles' own pieces into the *mid*
 * table, where they are painted in tile order -- so a tile to the
 * right of the one the character is standing at is painted after him
 * and comes down over him. That is how the original hides the hands
 * of a Prince climbing up behind the floor he is pulling himself onto,
 * and his shoulders behind the floor he is falling past.
 *
 * The port draws the whole room every tick and so has to put those
 * pieces back by hand; this says which.
 */
export interface CharacterOverlay {
  /** `char_col_left` and `char_col_right`, clamped to the room. */
  readonly colLeft: number;
  readonly colRight: number;
  /** `char_top_row` and `char_bottom_row`. */
  readonly topRow: number;
  readonly bottomRow: number;
  /** `if (char_action != 2)`: hanging marks the top row only. */
  readonly skipBottomRow: boolean;
  /** `obj_tilepos`: the tile he is painted with, from `Char.curr_col`. */
  readonly ownColumn: number;
  /**
   * Frames 137 to 144 take `draw_floor_overlay` rather than
   * `draw_other_overlay`: a sprite of the floor's lip from
   * `floor_left_overlay`, and then the tile's own front.
   */
  readonly climbFrame?: number;
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
  /**
   * `obj_tilepos = -1`, which `redraw_needed_tiles` draws after every
   * tile and every other object. The hurt splash is the only thing that
   * uses it.
   */
  readonly onTop?: boolean;
  /** Which tiles go back over him: see `CharacterOverlay`. */
  readonly overlay?: CharacterOverlay;
  /** `obj_clip_top`: nothing of him is drawn above this row. */
  readonly clipTop?: number;
}

/** The strip of the room above, drawn after every row of this one. */
const ROW_ABOVE_ORDER = -1;

/** `obj_clip_bottom`: the room is 192 rows, the hit points are below it. */
const ROOM_BOTTOM_Y = 192;

/**
 * `y_to_row_mod4`: which row of the drawing a falling slab belongs to.
 *
 * It comes out as -1 for a slab drawn through the hole it made --
 * `draw_mob` adds 192 to its y to put it back in the room above -- and
 * `get_tilepos_nominus` turns that into tile 30, which
 * `redraw_needed_tiles` draws before the room and therefore behind it.
 *
 * Putting it behind the room was tried and is worse: the slab is then
 * hidden by the pieces of the column it fell out of, and the capture
 * shows it plainly, because the original did not redraw those pieces
 * that tick. "Behind the room" in the original means behind whatever
 * the original redrew, and the port, which redraws everything, cannot
 * say what that was.
 *
 * `addMob` reads a -1 as the bottom row instead, which is where such a
 * slab is on the screen, and the rule in `Piece.mob` then lets the
 * floor of the column to its right come down over it. Across the five
 * captures of the third round that is fifteen ticks the port now draws
 * exactly and did not: the whole of `probeE` 79 and 81, `probeC` 79
 * and 81, `probeF` 79 and 81, and `0fbffa60` 77 and 79.
 */
function yToRowForMob(y: number): number {
  return Math.min(2, (Math.floor((y + 60) / 63) % 4) - 1);
}

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
   * The front of a floor: the slab under its walking surface. A character
   * in the row below passes behind it, which is how the original hides
   * the body of a Prince pulling himself up onto a ledge.
   */
  floorFront?: boolean;
  /**
   * Which pass of the room drawing put this here. The room is drawn from
   * the bottom row up, so a smaller number is painted later and therefore
   * over the top. See `PAINT_ORDERS`.
   */
  order: number;
  /** The tile this came out of, for the overlay rules. */
  col?: number;
  row?: number;
  /** Part of what `draw_tile2` draws, so part of an overlay. */
  tile2?: boolean;
  /** `tile_left == tiles_0_empty` when this tile was drawn. */
  leftEmpty?: boolean;
  /** For a character: which tiles go back over him. */
  overlay?: CharacterOverlay;
  /** `obj_clip_top`. */
  clipTop?: number;
  /**
   * A falling slab, which the tiles to its right in its own row cover.
   *
   * The original paints a room tile by tile, left to right within a
   * row, and paints the objects that belong to a tile when it reaches
   * that tile -- so whatever is drawn for column 7 lands on top of an
   * object sitting at column 6. For characters the port does not do
   * this, and measured that is right. For the slab it is wrong: the
   * slab is three sprites and the third of them, the sliver that
   * joins it to the tile on its right, is drawn a whole tile along
   * and so lands inside the next column, where the original's floor
   * comes down over it. Left uncovered it is a dark diagonal band
   * across the floor to the right of the hole, on every tick of every
   * fall -- `probeE` 79 to 81, `probeC` 79 to 81, `0fbffa60` 76 to 79.
   *
   * What pins it is the capture: with this and the row of a slab below
   * the room (see `yToRowForMob`), `probeE` 79 and 81, `probeC` 79 and
   * 81, `probeF` 79 and 81 and `0fbffa60` 77 and 79 are drawn exactly
   * and were not. A unit test was tried and thrown away: a room with
   * the loose tile taken out by hand is not the room the game has
   * while the slab is in the air, and the test was measuring the fake.
   */
  mob?: boolean;
}

/**
 * Where a character goes in the drawing.
 *
 * `set_objtile_at_char` gives every character a tile position and the
 * room is drawn tile by tile, so a character is painted when the
 * drawing reaches his tile. A position outside the room -- a row above
 * it or below it, a column off either end -- comes out of
 * `get_tilepos_nominus` as 30, and `redraw_needed_tiles` draws tile 30
 * before any tile of the room.
 *
 * The port used to paint such a character before the whole room, and
 * that is too much. "Before the room" in the original means before the
 * tiles it is going to redraw, and it redraws almost none of them: for
 * a Prince in the air the marked tiles get `draw_other_overlay` and
 * their fore layer and nothing else, so what comes back over him is
 * the overlay, not the room. Painting him with the bottom row and
 * letting `CharacterOverlay` take the pixels back is closer, and
 * measured it is worth thirteen ticks across the captures -- the lip
 * of the floor over the fingers of a Prince falling out of room 1 of
 * level 1, which every recording of that level has.
 */
type CharacterLayer = 'normal' | 'onTop';

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

/**
 * `floor_left_overlay`, for frames 137 to 144 of the climb: the lip of
 * the floor the Prince is pulling himself onto, drawn back over his
 * hands.
 */
const FLOOR_LEFT_OVERLAY = [32, 151, 151, 150, 150, 151, 32, 32];

/** The tiles `draw_floor_overlay` draws the lip for; the rest take `draw_tile2`. */
const FLOOR_OVERLAY_TILES = new Set<number>([
  TILE.floor, TILE.pillar, TILE.stuck, TILE.torch,
]);
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
  /** `obj_tilepos = -1`: painted after everything. */
  private onTop: Piece[] = [];
  private fore: Piece[] = [];
  private wipes: Wipe[] = [];
  /** Which list draw_tile_base / draw_tile_bottom append to. */
  private addTo: 'back' | 'fore' = 'back';
  /** Inside the part of `draw_tile` that `draw_tile2` draws again. */
  private inTile2 = false;
  /**
   * Inside `wall_pattern`, which names its table rather than taking
   * the one in hand -- so the bricks and chips of a wall are never
   * part of an overlay, however the tile they belong to was reached.
   */
  private inWallPattern = false;
  /** Per tile, what the climbing lip needs: keyed row * 10 + column. */
  private tileInfo = new Map<number, { x: number; mainY: number; curr: number }>();

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
    this.onTop = [];
    this.fore = [];
    this.wipes = [];
    this.addTo = 'back';
    this.inTile2 = false;
    this.inWallPattern = false;
    this.tileInfo.clear();
    this.paintOrder = ROW_ABOVE_ORDER + 1;
    this.drawnRoom = room;
    this.palaceWallColors = this.opt.palaceWallColors ?? generatePalaceWallColors(room);
    this.loadRoomLinks();
    this.drawRoom();
    // `do_mobs()` is the first line of `play_frame` and `draw_kid` is
    // in the drawing after it, so a slab is in the object table before
    // any character and comes first where the two sort equal.
    for (const m of mobs) this.addMob(m);
    for (const c of characters) this.addCharacter(c);
    // `reset_obj_clip`: everything drawn in the room is clipped to the
    // room's own 192 rows. Without it a Prince stepping off the bottom
    // row of a room has his feet drawn across the hit points below.
    const clip = surface.clipBottom;
    surface.clipBottom = ROOM_BOTTOM_Y;
    this.paint(surface);
    surface.clipBottom = clip;
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

  /** `addCurrent`, and mark what it added as the front of a floor. */
  private addFloorFront(
    chtab: ChtabId, id: number, x: number, yBottom: number, blit: number,
  ): boolean {
    const list = this.addTo === 'back' ? this.back : this.fore;
    const added = this.addCurrent(chtab, id, x, yBottom, blit);
    if (added) list[list.length - 1].floorFront = true;
    return added;
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
    list.push({
      chtab, id, x, yBottom, blit, order: this.paintOrder,
      col: this.drawnCol, row: this.drawnRow,
      tile2: this.inTile2 && !this.inWallPattern,
      leftEmpty: this.tileLeft === TILE.empty,
    });
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
   *
   * It runs out at one, not at nought. `animateButton` writes the timer
   * back and then drops the tile off the list of things to animate once
   * it is below two, so the last value ever written is one and nothing
   * will ever write a nought. A plate that counted one as pressed stayed
   * sunk for the rest of the level, which is what the player saw: step
   * on it, step off, and it never comes back up.
   */
  /**
   * The modifier goes with the type. A button's modifier is an index into
   * the level's door links and means nothing to a floor, which reads its
   * modifier as which of four marks to put on the wall above it -- so a
   * plate whose link happened to be numbered one, two or three hung a
   * decoration in the air the moment a foot came down on it, and took it
   * away again when the foot left. Rooms 12 and 20 of level 1 both have
   * one. A plate pressed flush is a plain floor, mark and all.
   */
  private pressedToFloor(
    type: number, modifier: number,
  ): { type: number; modifier: number } {
    if (type !== TILE.opener && type !== TILE.closer) return { type, modifier };
    return (this.tiles.doorLinkTimer?.(modifier) ?? 0) > 1
      ? { type: TILE.floor, modifier: 0 }
      : { type, modifier };
  }

  private loadCurrentAndLeftTile(): void {
    const outside = this.drawnRow === 2 ? this.opt.topLevelEdgeTile : TILE.wall;
    const curr = this.tileToDraw(this.drawnRoom, this.drawnCol, this.drawnRow, outside);
    const here = this.pressedToFloor(curr.type, curr.modifier);
    this.currTile = here.type;
    this.currModifier = here.modifier;
    const left = this.tileToDraw(this.drawnRoom, this.drawnCol - 1, this.drawnRow, outside);
    const beside = this.pressedToFloor(left.type, left.modifier);
    this.tileLeft = beside.type;
    this.modifierLeft = beside.modifier;
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
    // `draw_tile2` is the rest of it bar the fore layer, and it is what
    // goes back over a character who is falling or climbing past this
    // tile -- see `CharacterOverlay`.
    this.inTile2 = true;
    this.tileInfo.set(this.drawnRow * 10 + this.drawnCol, {
      x: this.drawX, mainY: this.drawMainY, curr: this.currTile,
    });
    this.drawTileRight();
    this.drawTileAnimRight();
    this.drawTileBottom();
    this.drawLoose();
    this.drawTileBase();
    this.drawTileAnim();
    this.inTile2 = false;
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
    if (chtab === CHTAB.environmentWall) {
      this.addCurrent(chtab, id, this.drawX, this.drawBottomY, blit);
      this.wallPattern(0, 0);
    } else {
      this.addFloorFront(chtab, id, this.drawX, this.drawBottomY, blit);
    }
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
    this.addFloorFront(
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
    const savedInWall = this.inWallPattern;
    this.inWallPattern = true;
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
    this.inWallPattern = savedInWall;
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
    // `draw_mob`. A slab that has gone through the floor is still drawn
    // in the room it came from, through the hole it made, for the first
    // eighteen pixels of its fall into the room below -- and one in the
    // room above is drawn here once it is within fifteen of the bottom.
    // Without the first of those the hole opens two ticks too early:
    // the port had the slab vanish the moment it crossed into the next
    // room, leaving a bare black tile where the original still shows
    // the plank sliding out of it.
    let y = m.y;
    if (m.room === this.drawnRoom) {
      if (m.y >= 210) return;
    } else if (m.room === this.roomB) {
      if (Math.abs((m.y << 24) >> 24) >= 18) return;
      y = m.y + 192;
    } else if (m.room === this.roomA) {
      if (m.y < 174) return;
      y = m.y - 189;
    } else {
      return;
    }
    // The column is the column: `COL_X` is indexed the same way the tile
    // loop indexes it. The +1 that used to be here put the falling floor
    // one tile to the right of the hole it came out of, which usually
    // means inside a wall, so it was never seen at all.
    const col = m.column;
    if (col < 0 || col >= COL_X.length) return;
    const x = COL_X[col];
    // -1 is a slab drawn through the hole it made, which is at the foot
    // of the room: the bottom row. See `yToRowForMob`.
    const rawRow = yToRowForMob(y);
    const order = rawRow < 0 ? 2 : rawRow;
    // `draw_mid_obj` case 10, and the ten is the point: a slab that has
    // come away is not drawn with the pictures of a floor at rest.
    // `add_mob_to_objtable` gives it `id = 10`, which indexes the same
    // `loose_fram_*` tables the shaking floor uses and lands on the
    // tilted pictures -- 70, 74 and 72 -- not on 41, 43 and 42. The
    // port used index nought, so a falling plank was drawn as a tidy
    // flat floor hanging in the air: the right height, the wrong shape,
    // and a good half-tile short on its left.
    const MOB = 10;
    this.mid.push({
      chtab: CHTAB.environment, id: LOOSE_FRAM_LEFT[MOB], x, mob: true,
      yBottom: y - 3, blit: BLIT.transparent, order,
    });
    this.mid.push({
      chtab: CHTAB.environment, id: LOOSE_FRAM_BOTTOM[MOB], x, yBottom: y, mob: true,
      blit: BLIT.opaque, order,
    });
    // And the piece that joins it to the tile on its right, a tile
    // along and a pixel up. This was in the port once, with the wrong
    // sprite and no way of telling, and taking it out scored better
    // than leaving it in. With the right sprite and an exact
    // comparison it is twenty-six pixels of plank that were missing
    // from every tick of every fall.
    //
    // It lands inside the next column, and in the original the floor
    // of that column comes down over most of it -- which is what
    // `mob: true` is for. Without that it is a dark diagonal band lying
    // across the floor to the right of the hole, and it was what made
    // the piece look wrong both times.
    //
    // `add_mob_to_objtable` also gives the slab a clip forty pixels
    // wide, which would leave eight pixels of this piece and cut the
    // other eighteen -- but `chtab_flip_clip[6]` is nought, so
    // `draw_mid` never sets a clip rectangle for anything out of the
    // environment chtab and the forty is dead. Measured, that is what
    // the capture shows: with the clip applied, four ticks that are
    // exact stop being exact.
    this.mid.push({
      chtab: CHTAB.environment, id: LOOSE_FRAM_RIGHT[MOB], x: x + 32, mob: true,
      yBottom: y - 1, blit: BLIT.transparent, order,
    });
    // And nothing in the next column along. A floor at rest is three
    // pieces -- its top, its front, and the sliver that joins it to the
    // tile on its right -- but one that has come away is a single sprite
    // in the original, which `add_mob_to_objtable` puts in the object
    // table with `id = 10` and a clip forty wide. The port was drawing
    // the joining sliver with it, so the falling slab was half a tile
    // too wide on its right.
    //
    // Measured on the player's recording `e209b01a`, where the loose
    // floor of room 1 comes down into room 2 with him: the original's
    // plank covers screen x 192 to about 225, and the port's covered
    // 192 to 249.
    //
    // Put back once, on the strength of `draw_mid_obj`, which does add
    // all three pieces -- and taken out again: across the ten captures
    // it cost twenty-four of the ticks the port had exactly right and
    // gained none.
    //
    // The other half of `draw_mob` -- the slab drawn on through the
    // hole it made -- was also tried once and taken out, on captures of
    // the recordings that were too noisy to see it. The probes are not:
    // with it, every one of them goes up and none goes down.
  }

  private addCharacter(c: CharacterDraw): void {
    const set = this.chtabs[c.chtab];
    if (!set) return;
    const img = set.images[c.image];
    if (!img) return;
    const row = c.row ?? 0;
    const layer: CharacterLayer = c.onTop ? 'onTop' : 'normal';
    const list = layer === 'onTop' ? this.onTop : this.mid;
    list.push({
      chtab: c.chtab,
      id: c.image,
      x: c.x,
      yBottom: c.y,
      blit: BLIT.transparent,
      character: true,
      flip: c.direction === 0,
      screenX: c.alreadyScreenX === true,
      // A row above the room or below it is painted with the nearest
      // row of it: see `CharacterLayer`.
      order: Math.min(2, Math.max(0, row)),
      overlay: c.overlay,
      clipTop: c.clipTop,
      col: c.overlay ? c.overlay.ownColumn : undefined,
    });
  }

  /**
   * Every piece of the room, then everyone standing in it, then the few
   * pieces the original keeps in front of them -- and, between the last
   * two, the front of every floor above each character.
   *
   * That last bit is the ledge a climbing Prince disappears behind. It
   * took two measurements to get right, and they pull in opposite
   * directions.
   *
   * The first says the row above does *not* cover him. Count the pixels
   * of the Prince on the climb up the left of room 2 in the recorded run
   * `b4ff4672`, ticks 175 to 179:
   *
   *     the original          232  271  296  272  220
   *     painted this way      232  271  296  272  220
   *     row by row            215  187  156  121   82
   *
   * -- painting the rows bottom-up with each character in with his own
   * row eats his head as he rises into the row above, and the original
   * does not.
   *
   * The second says a ledge *does* cover him. The probe
   * `14.,4d,5r,9u,18s,8u,24.` -- level 1, jump up and take hold of the
   * ledge at the right of room 1's middle row, then climb it -- had the
   * port drawing his body over the front of that ledge for five ticks
   * where the original draws only his head and arms above it. That is
   * what the player meant by seeing the palms of his hands.
   *
   * What tells the two apart is not the row but the piece. A floor's
   * front -- the slab under the surface you walk on, which
   * `drawTileBase` and `drawTileBottom` lay down -- goes in front of
   * anyone in the row below it. A wall's back, which is what stands
   * above him at a room's edge, does not. So those pieces, and only
   * those, are painted a second time over each character who is below
   * them, and the two measurements agree: the climb at the edge is
   * untouched, and the climb onto the ledge is now pixel for pixel the
   * original's for every frame of it.
   */
  private paint(surface: Surface): void {
    this.paintWipes(surface, 0);
    for (const p of this.back) this.paintPiece(surface, p);
    // Nearest first, so that a character lower down is painted before the
    // floors that have to cover a character higher up.
    //
    // Within one tile the original sorts by y and paints the smaller
    // first -- `compare_curr_objs` swaps while `y[i] > y[i+1]` -- so
    // whatever is lower on the screen ends up on top. That is how a
    // character comes out in front of his own sword: the sword's object
    // sits twenty-five pixels above his feet, so it is painted first
    // and his hand covers the pixel of hilt that would otherwise show
    // through it. Without the rule the port drew one pixel of blade
    // over the guard's knuckle, every fourth tick of his advance.
    const characters = [...this.mid].sort(
      (a, b) => (b.order - a.order) || (a.yBottom - b.yBottom),
    );
    for (const c of characters) {
      this.paintPiece(surface, c);
      // And then the front of every floor above him, again. They are the
      // same pixels they were the first time, over the character instead
      // of under him, which is the whole of the difference.
      //
      // For a falling slab, the floors of its own row that are further
      // right as well: see `Piece.mob`.
      for (const p of this.back) {
        if (!p.floorFront) continue;
        if (p.order < c.order || (c.mob === true && p.order === c.order && p.x > c.x)) {
          this.paintPiece(surface, p);
        }
      }
      if (c.overlay) this.paintOverlay(surface, c);
    }
    this.paintWipes(surface, 1);
    for (const p of this.fore) this.paintPiece(surface, p);
    // `draw_objtable_items_at_tile(-1)`, which comes after everything.
    for (const p of this.onTop) this.paintPiece(surface, p);
  }

  /**
   * `draw_other_overlay` and `draw_floor_overlay`: the tiles a falling
   * or climbing character marked, drawn again over him.
   *
   * Only the tiles past the one he is at: the original paints a room
   * left to right and a character with the tile he stands at, so the
   * tiles before his are under him and the ones after are over him.
   * And only where the tile to the left is empty, which is the test
   * both of those functions start with -- a floor with a floor beside
   * it has nothing of its own sticking out to the left to redraw.
   */
  private paintOverlay(surface: Surface, c: Piece): void {
    const o = c.overlay;
    if (!o) return;
    const rows = o.skipBottomRow ? [o.topRow]
      : o.topRow === o.bottomRow ? [o.bottomRow] : [o.topRow, o.bottomRow];
    const own = c.col ?? -1;
    for (const row of rows) {
      if (row < 0 || row > 2) continue;
      for (let col = Math.max(o.colLeft, own + 1); col <= o.colRight; col++) {
        const info = this.tileInfo.get(row * 10 + col);
        if (!info) continue;
        // An empty tile has nothing of its own: every id `draw_tile2`
        // would look up for it is nought and `add_backtable` returns
        // without drawing. The port draws the dark blue behind the
        // room for such a tile, which is not a tile's picture and must
        // not come back over anybody -- it put the wall's dither
        // across the Prince as he swung up into room 2 of level 1,
        // tick 83 of `probeE`.
        if (info.curr === TILE.empty) continue;
        // `if (tile_left != tiles_0_empty) return;` -- the piece this
        // would put back is the part of the tile that overhangs an
        // empty one, and there is none when a floor adjoins a floor.
        const pieces = this.back.filter(
          (p) => p.tile2 && p.row === row && p.col === col && p.leftEmpty,
        );
        if (!pieces.length) continue;
        if (o.climbFrame !== undefined && FLOOR_OVERLAY_TILES.has(info.curr)) {
          // `draw_floor_overlay`: the lip of the floor, then its front
          // -- `draw_tile_bottom(0)` -- and nothing else of the tile.
          const id = FLOOR_LEFT_OVERLAY[o.climbFrame - 137] ?? 0;
          const yBottom = info.mainY + (info.curr === TILE.stuck ? 1 : 0);
          if (id) {
            this.paintPiece(surface, {
              chtab: CHTAB.environment, id, x: info.x, yBottom,
              blit: BLIT.transparent, order: row,
            });
          }
          for (const p of pieces) if (p.floorFront) this.paintPiece(surface, p);
          continue;
        }
        for (const p of pieces) this.paintPiece(surface, p);
      }
    }
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
      const clip = surface.clipTop;
      if (p.clipTop !== undefined) surface.clipTop = p.clipTop;
      surface.blitTransparent(sprite, x, y, base);
      surface.clipTop = clip;
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

