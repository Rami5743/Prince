/**
 * Assembling everything a level needs to be drawn: the right tile set for its
 * type, the sprite groups, the palette, and the level's tiles with their
 * modifiers already rewritten the way the original rewrites them on load.
 */
import type { Assets } from '../render/assets.ts';
import type { Chtabs, RoomTiles, RoomRenderOptions } from '../render/room.ts';
import { ScreenPalette } from '../render/surface.ts';
import { parseLevel, resourceIdOfLevel, type Level } from '../dat/level.ts';
import { LevelState } from './level-state.ts';
import { readExeConstants, type ExeConstants } from './exe-constants.ts';
import { GUARD_TYPE_BY_LEVEL, GUARD_FILES } from './guard.ts';
import type { SpriteSet } from '../render/assets.ts';

export interface LevelScene {
  readonly level: Level;
  /** The level as it is now, which the traps and the renderer both read. */
  readonly state: LevelState;
  readonly constants: ExeConstants;
  readonly chtabs: Chtabs;
  /** The 256-colour hardware palette, with each group's block loaded. */
  readonly screenPalette: ScreenPalette;
  readonly tiles: RoomTiles;
  readonly options: RoomRenderOptions;
  /** Which kind of enemy this level has, or -1 for none. */
  readonly guardType: number;
  /** PRINCE.DAT resource 10: seven recolourings of the guard's sixteen. */
  readonly guardPalettes?: Uint8Array;
}

/**
 * Where each sprite group's sixteen colours sit in the 256-colour palette.
 * These are the blocks the original asked for when it loaded each group.
 */
export const PALETTE_BASE = {
  /** The default VGA colours; mono blits and the status bar use these. */
  global: 0,
  sword: 2 * 16,
  flameSwordPotion: 3 * 16,
  environment: 5 * 16,
  environmentWall: 6 * 16,
  kid: 7 * 16,
  guard: 8 * 16,
} as const;

/** Tile set file for a level, by video mode prefix and level type. */
export function tilesetFileFor(levelType: number, prefix = 'V'): string {
  return `${prefix}${levelType ? 'PALACE' : 'DUNGEON'}.DAT`;
}

/**
 * The alternate level colours, which 1.0 has not got at all.
 *
 * `redraw_screen`'s own lines, from `seg000.c`:
 *
 *     if (graphics_mode == gmMcgaVga && level_var_palettes != NULL) {
 *         int level_color = custom->tbl_level_color[current_level];
 *         if (level_color != 0) {
 *             byte* env_pal = level_var_palettes + 0x30*(level_color-1);
 *             byte* wall_pal = env_pal + 0x30 * tbl_level_type[current_level];
 *             set_pal_arr(0x50, 0x10, env_pal);
 *             set_pal_arr(0x60, 0x10, wall_pal);
 *             ...
 *
 * `level_var_palettes` is `PRINCE.DAT` **resource 20**, and the guard
 * on it is `!= NULL`: the release that has no such resource simply
 * does not recolour. That is exactly how this works, and it is why
 * nothing here reads a setting. 1.0's `PRINCE.DAT` is 3278 bytes and
 * has resources 1, 2, 10, 150..173 and 700..734 -- **no 20** -- so a
 * port given 1.0's files keeps 1.0's colours by construction, every
 * headless tool and every capture comparison included. 1.4's is
 * 25600 bytes and its resource 20 is 240: five palettes of sixteen,
 * which is the whole of the "new colour scheme on some levels" the
 * later releases are described by.
 *
 * The wall takes the block **after** the environment's for a palace
 * and the same one for a dungeon, which is what the `0x30 *
 * tbl_level_type` does, so a palace reads two consecutive blocks.
 */
const TBL_LEVEL_COLOUR: readonly number[] =
  [0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 0, 0, 3, 3, 4, 0];

/** `PRINCE.DAT` resource 20, or nothing where the release has none. */
async function levelPalettes(assets: Assets): Promise<Uint8Array | undefined> {
  try {
    const princeDat = await assets.dat('PRINCE.DAT');
    return princeDat.has(20) ? princeDat.get(20) : undefined;
  } catch {
    return undefined;
  }
}

function applyLevelColour(
  palette: ScreenPalette,
  blocks: Uint8Array | undefined,
  levelNumber: number,
  levelType: number,
): void {
  if (!blocks) return;
  const colour = TBL_LEVEL_COLOUR[levelNumber] ?? 0;
  if (colour === 0) return;
  const env = 0x30 * (colour - 1);
  const wall = env + 0x30 * levelType;
  if (wall + 0x30 > blocks.length) return; // a shorter resource than the table wants
  /**
   * Colour nought of an alternate block is **not** the block's own.
   *
   * `set_chtab_palette` says so in a comment that names the very
   * level it was written for: "Color 0 of the palette data is not
   * used, it is replaced by the background color. Needed for correct
   * alternate colors (v1.3) of level 8." Taken from the data it is
   * pale, and level 8's dark alcoves and the squares behind its
   * torches come out **white** -- which is what this looked like
   * before the line went in, screenshotted on levels 8 and 9.
   */
  const entries = (at: number): { r: number; g: number; b: number }[] => {
    const out = [{ r: 0, g: 0, b: 0 }];
    for (let i = 1; i < 16; i++) {
      out.push({ r: blocks[at + i * 3]!, g: blocks[at + i * 3 + 1]!, b: blocks[at + i * 3 + 2]! });
    }
    return out;
  };
  palette.loadBlock(PALETTE_BASE.environment, entries(env));
  palette.loadBlock(PALETTE_BASE.environmentWall, entries(wall));
}

export async function buildLevelScene(
  assets: Assets,
  exe: Uint8Array,
  levelNumber: number,
  prefix = 'V',
): Promise<LevelScene> {
  const constants = readExeConstants(exe);
  const levelsDat = await assets.dat('LEVELS.DAT');
  const resourceId = resourceIdOfLevel(levelNumber);
  const level = parseLevel(levelsDat.get(resourceId), resourceId);

  const levelType = constants.levelType[levelNumber] ?? 0;
  const tilesetFile = tilesetFileFor(levelType, prefix);

  const environment = await assets.group(tilesetFile, 200, PALETTE_BASE.environment, true);
  const environmentWall = await assets.group(tilesetFile, 360, PALETTE_BASE.environmentWall);
  const flameSwordPotion = await assets.group('PRINCE.DAT', 150, PALETTE_BASE.flameSwordPotion);
  const kid = await assets.group('KID.DAT', 400, PALETTE_BASE.kid);
  const sword = await assets.group('PRINCE.DAT', 700, PALETTE_BASE.sword);

  // The enemy of this level, and its colours. A plain guard's sprites carry
  // no palette of their own: GUARD1.DAT (palace) or GUARD2.DAT (dungeon)
  // supplies one, and a per-room recolouring may replace it.
  const guardType: number = GUARD_TYPE_BY_LEVEL[levelNumber] ?? -1;
  let guard: SpriteSet | undefined;
  let guardPalettes: Uint8Array | undefined;
  const guardFile: string | undefined = GUARD_FILES[guardType as 0 | 1 | 2 | 3 | 4];
  if (guardFile) {
    const headerFile = guardType === 0
      ? (levelType ? 'GUARD1.DAT' : 'GUARD2.DAT')
      : guardFile;
    guard = await assets.group(guardFile, 750, PALETTE_BASE.guard, false, headerFile);
    const princeDat = await assets.dat('PRINCE.DAT');
    guardPalettes = princeDat.get(10);
  }

  const screenPalette = new ScreenPalette();
  screenPalette.loadBlock(PALETTE_BASE.global, constants.vgaPalette);
  for (const set of [environment, environmentWall, flameSwordPotion, kid, sword]) {
    screenPalette.loadBlock(set.paletteBase, set.palette.vga);
  }
  applyLevelColour(screenPalette, await levelPalettes(assets), levelNumber, levelType);
  if (guard) screenPalette.loadBlock(guard.paletteBase, guard.palette.vga);

  const state = new LevelState(level);
  const tiles: RoomTiles = {
    typeAt: (room, column, row) => state.typeAt(room, column, row),
    modifierAt: (room, column, row) => state.modifierAt(room, column, row),
    linkOf: (room, dir) => state.linkOf(room, dir),
    doorLinkTimer: (index) => state.doorLinkTimer(index),
  };

  return {
    level,
    state,
    constants,
    chtabs: { environment, environmentWall, flameSwordPotion, kid, sword, guard },
    guardType,
    guardPalettes,
    screenPalette,
    tiles,
    options: {
      levelType,
      topLevelEdgeTile: constants.drawnTileTopLevelEdge,
      leftLevelEdgeTile: constants.drawnTileLeftLevelEdge,
      enableWdaInPalace: constants.enableWdaInPalace,
      startRoom: level.startRoom,
    },
  };
}
