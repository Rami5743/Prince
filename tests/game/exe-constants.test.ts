import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { readExeConstants, checkExe } from '../../src/game/exe-constants.ts';

const uncracked = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const cracked = new Uint8Array(readFileSync(join(GAME_DIR, 'PRINCE.EXE')));

describe('constants read from the original executable', () => {
  it('reads the values the game is known to start with', () => {
    const c = readExeConstants(uncracked);
    expect(c.startMinutesLeft).toBe(60);
    expect(c.startTicksLeft).toBe(719);
    expect(c.startHitPoints).toBe(3);
    expect(c.maxHitPointsAllowed).toBe(10);
    expect(c.firstLevel).toBe(1);
    expect(c.savingAllowedFirstLevel).toBe(3);
    expect(c.savingAllowedLastLevel).toBe(13);
    expect(c.copyProtectionLevel).toBe(2);
  });

  it('reads which levels are dungeon and which are palace', () => {
    const c = readExeConstants(uncracked);
    expect([...c.levelType]).toEqual([0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(c.enableWdaInPalace).toBe(false);
  });

  it('reads the scripted events: mirror, skeleton, checkpoint', () => {
    const c = readExeConstants(uncracked);
    expect([c.mirrorLevel, c.mirrorRoom]).toEqual([4, 4]);
    expect([c.skeletonLevel, c.skeletonRoom, c.skeletonColumn, c.skeletonRow])
      .toEqual([3, 1, 5, 1]);
    expect(c.checkpointLevel).toBe(3);
    expect(c.checkpointRespawnDir).toBe(-1);
    expect(c.checkpointRespawnRoom).toBe(2);
    expect(c.checkpointRespawnTilePos).toBe(6);
  });

  it('reads the level edge tiles the renderer needs', () => {
    const c = readExeConstants(uncracked);
    expect(c.drawnTileTopLevelEdge).toBe(1);
    expect(c.drawnTileLeftLevelEdge).toBe(20);
    expect(c.levelEdgeHitTile).toBe(20);
  });

  it('reads the default 16-colour palette', () => {
    const c = readExeConstants(uncracked);
    expect(c.vgaPalette[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(c.vgaPalette[15]).toEqual({ r: 63, g: 63, b: 63 });
    expect(c.vgaPalette[6]).toEqual({ r: 42, g: 21, b: 0 });
    for (const c6 of c.vgaPalette) {
      for (const v of [c6.r, c6.g, c6.b]) expect(v).toBeLessThanOrEqual(63);
    }
  });

  it('the crack did not touch any of these values', () => {
    expect(readExeConstants(cracked)).toEqual(readExeConstants(uncracked));
  });

  it('refuses an executable it does not recognise', () => {
    expect(() => checkExe(uncracked.subarray(0, 1000))).toThrow(/unsupported/);
    const corrupted = uncracked.slice();
    corrupted[0] = 0;
    expect(() => checkExe(corrupted)).toThrow(/MZ/);
  });
});
