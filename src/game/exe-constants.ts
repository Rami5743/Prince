/**
 * Game constants read out of the original executable.
 *
 * The rules of Prince of Persia are not only in its data files: the starting
 * time, the hit points, which levels are dungeon and which are palace, where
 * the mirror and the skeleton are, all of it lives inside PRINCE.EXE. Rather
 * than copy those numbers into source, this port reads them from the
 * executable it ships with, so they cannot drift from the original.
 *
 * The offsets are for the 123 335-byte release in `original/prince1/`; both
 * `PRINCE.EXE` and `UNCRKD.EXE` carry identical values here, since the crack
 * only touched code. `readExeConstants` checks a fingerprint before trusting
 * any offset.
 */

export interface Rgb6 {
  r: number;
  g: number;
  b: number;
}

export interface ExeConstants {
  readonly startMinutesLeft: number;
  readonly startTicksLeft: number;
  readonly startHitPoints: number;
  readonly firstLevel: number;
  readonly maxHitPointsAllowed: number;
  readonly savingAllowedFirstLevel: number;
  readonly savingAllowedLastLevel: number;
  readonly copyProtectionLevel: number;
  /** Tile drawn above the top row of a level. */
  readonly drawnTileTopLevelEdge: number;
  /** Tile drawn to the left of the leftmost column of a level. */
  readonly drawnTileLeftLevelEdge: number;
  readonly levelEdgeHitTile: number;
  /** 0 = dungeon, 1 = palace, indexed by level number 0..15. */
  readonly levelType: Uint8Array;
  /** Guard hit points, indexed by level number. */
  readonly guardHitPoints: Uint8Array;
  readonly demoHitPoints: number;
  readonly demoEndRoom: number;
  readonly introMusicLevel: number;
  readonly checkpointLevel: number;
  readonly checkpointRespawnDir: number;
  readonly checkpointRespawnRoom: number;
  readonly checkpointRespawnTilePos: number;
  readonly skeletonLevel: number;
  readonly skeletonRoom: number;
  readonly skeletonColumn: number;
  readonly skeletonRow: number;
  readonly mirrorLevel: number;
  readonly mirrorRoom: number;
  /** The 16-colour default palette, 6-bit components. */
  readonly vgaPalette: readonly Rgb6[];
  readonly enableWdaInPalace: boolean;
}

/** Offsets into the 123 335-byte DOS release. */
const OFF = {
  startMinutesLeft: 0x04a23,
  startTicksLeft: 0x04a29,
  startHitPoints: 0x04a2f,
  firstLevel: 0x00707,
  maxHitPointsAllowed: 0x013f1,
  savingAllowedFirstLevel: 0x007c8,
  savingAllowedLastLevel: 0x007cf,
  copyProtectionLevel: 0x1aaeb,
  drawnTileTopLevelEdge: 0x0a1f0,
  drawnTileLeftLevelEdge: 0x0a26b,
  levelEdgeHitTile: 0x06f02,
  levelType: 0x1acea,
  guardHitPoints: 0x1b8a8,
  vgaPalette: 0x1d141,
  demoHitPoints: 0x04c28,
  demoEndRoom: 0x00b40,
  introMusicLevel: 0x04c37,
  checkpointLevel: 0x04b9e,
  checkpointRespawnDir: 0x04bac,
  checkpointRespawnRoom: 0x04bb1,
  checkpointRespawnTilePos: 0x04bb6,
  skeletonLevel: 0x046a4,
  skeletonRoom: 0x046b8,
  skeletonColumn: 0x046de,
  skeletonRow: 0x046e2,
  mirrorLevel: 0x08dc7,
  mirrorRoom: 0x08dcb,
  enableWdaInPalace: 0x0a7bb,
} as const;

export const SUPPORTED_EXE_SIZE = 123335;

/**
 * Confirm this is the executable the offsets were taken from before reading
 * anything out of it. A wrong build would otherwise yield plausible rubbish.
 */
export function checkExe(exe: Uint8Array): void {
  if (exe.length !== SUPPORTED_EXE_SIZE) {
    throw new Error(
      `unsupported PRINCE.EXE: ${exe.length} bytes, expected ${SUPPORTED_EXE_SIZE}`,
    );
  }
  if (exe[0] !== 0x4d || exe[1] !== 0x5a) {
    throw new Error('not a DOS executable (no MZ signature)');
  }
  const levelType = exe.subarray(OFF.levelType, OFF.levelType + 16);
  for (const v of levelType) {
    if (v > 1) throw new Error('level type table does not look like dungeon/palace flags');
  }
}

export function readExeConstants(exe: Uint8Array): ExeConstants {
  checkExe(exe);
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u8 = (o: number) => exe[o];

  const vgaPalette: Rgb6[] = [];
  for (let i = 0; i < 16; i++) {
    const o = OFF.vgaPalette + i * 3;
    vgaPalette.push({ r: exe[o], g: exe[o + 1], b: exe[o + 2] });
  }

  return {
    startMinutesLeft: u16(OFF.startMinutesLeft),
    startTicksLeft: u16(OFF.startTicksLeft),
    startHitPoints: u16(OFF.startHitPoints),
    firstLevel: u16(OFF.firstLevel),
    maxHitPointsAllowed: u16(OFF.maxHitPointsAllowed),
    savingAllowedFirstLevel: u8(OFF.savingAllowedFirstLevel) + 1,
    savingAllowedLastLevel: u8(OFF.savingAllowedLastLevel) - 1,
    copyProtectionLevel: u16(OFF.copyProtectionLevel),
    drawnTileTopLevelEdge: u8(OFF.drawnTileTopLevelEdge),
    drawnTileLeftLevelEdge: u8(OFF.drawnTileLeftLevelEdge),
    levelEdgeHitTile: u8(OFF.levelEdgeHitTile),
    levelType: exe.slice(OFF.levelType, OFF.levelType + 16),
    guardHitPoints: exe.slice(OFF.guardHitPoints, OFF.guardHitPoints + 16),
    demoHitPoints: u8(OFF.demoHitPoints),
    demoEndRoom: u8(OFF.demoEndRoom),
    introMusicLevel: u8(OFF.introMusicLevel),
    checkpointLevel: u8(OFF.checkpointLevel),
    checkpointRespawnDir: (u8(OFF.checkpointRespawnDir) << 24) >> 24,
    checkpointRespawnRoom: u8(OFF.checkpointRespawnRoom),
    checkpointRespawnTilePos: u8(OFF.checkpointRespawnTilePos),
    skeletonLevel: u8(OFF.skeletonLevel),
    skeletonRoom: u8(OFF.skeletonRoom),
    skeletonColumn: u8(OFF.skeletonColumn),
    skeletonRow: u8(OFF.skeletonRow),
    mirrorLevel: u8(OFF.mirrorLevel),
    mirrorRoom: u8(OFF.mirrorRoom),
    vgaPalette,
    // The original compares against 116; anything else means the "wall
    // decoration algorithm" was enabled for palace levels too.
    enableWdaInPalace: u8(OFF.enableWdaInPalace) !== 116,
  };
}

export const LEVEL_TYPE_DUNGEON = 0;
export const LEVEL_TYPE_PALACE = 1;
