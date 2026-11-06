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
  if (guard) screenPalette.loadBlock(guard.paletteBase, guard.palette.vga);

  const state = new LevelState(level);
  const tiles: RoomTiles = {
    typeAt: (room, column, row) => state.typeAt(room, column, row),
    modifierAt: (room, column, row) => state.modifierAt(room, column, row),
    linkOf: (room, dir) => state.linkOf(room, dir),
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
