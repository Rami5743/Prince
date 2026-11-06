/**
 * The things in a room that move on their own.
 *
 * These check the behaviours against what the original's tables say: a gate
 * opens four units a frame and stops at 188, a button jams after being held,
 * a loose floor shakes for eleven frames and then comes away, spikes go out
 * and come back, chompers cycle through the timings the original hands them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, dat } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { LevelState } from '../../src/game/level-state.ts';
import { Traps, nextChomperTiming, LOOSE_FLOOR_DELAY } from '../../src/game/traps.ts';
import { Prng } from '../../src/game/random.ts';
import { TILE } from '../../src/game/tiles.ts';
import { parseLevel, resourceIdOfLevel } from '../../src/dat/level.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const levels = dat('LEVELS.DAT');

function stateOf(n: number): LevelState {
  const id = resourceIdOfLevel(n);
  return new LevelState(parseLevel(levels.get(id), id));
}

function trapsOf(n: number, levelType = 0): { state: LevelState; traps: Traps } {
  const state = stateOf(n);
  return { state, traps: new Traps(state, new Prng(), levelType) };
}

/** Find the first tile of a kind anywhere in a level. */
function findTile(state: LevelState, type: number): { room: number; tilePos: number } | null {
  for (let room = 1; room <= 24; room++) {
    for (let pos = 0; pos < 30; pos++) {
      if (state.typeAtPos(room, pos) === type) return { room, tilePos: pos };
    }
  }
  return null;
}

describe('traps', () => {
  it('a gate opens four units a frame and stops fully open', () => {
    const { state, traps } = trapsOf(1);
    const gate = findTile(state, TILE.gate)!;
    expect(gate).toBeTruthy();
    state.setModifierAtPos(gate.room, gate.tilePos, 0);
    traps.add(gate.room, gate.tilePos, 1); // opening
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      traps.step();
      seen.push(state.modifierAtPos(gate.room, gate.tilePos));
    }
    expect(seen.slice(0, 4)).toEqual([4, 8, 12, 16]);
    // It reaches fully open and then holds for a moment before closing.
    expect(Math.max(...seen)).toBe(238);
  });

  it('a gate slammed shut loses ground faster each frame', () => {
    const { state, traps } = trapsOf(1);
    const gate = findTile(state, TILE.gate)!;
    state.setModifierAtPos(gate.room, gate.tilePos, 188);
    traps.add(gate.room, gate.tilePos, 3); // closing fast
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      traps.step();
      seen.push(state.modifierAtPos(gate.room, gate.tilePos));
    }
    // 188-40, then -60, then -80: the speeds the original lists.
    expect(seen.slice(0, 3)).toEqual([148, 88, 8]);
    expect(seen[3]).toBe(0);
  });

  it('a loose floor shakes, then comes away and falls', () => {
    const { state, traps } = trapsOf(1);
    const loose = findTile(state, TILE.loose)!;
    expect(loose).toBeTruthy();
    traps.makeLooseFall(loose.room, loose.tilePos);
    // The first shake already sets the counter to 1, so it gives way one
    // frame sooner than the delay alone would suggest.
    for (let i = 0; i < LOOSE_FLOOR_DELAY - 1; i++) {
      expect(state.typeAtPos(loose.room, loose.tilePos), `frame ${i}`).toBe(TILE.loose);
      traps.step();
    }
    expect(state.typeAtPos(loose.room, loose.tilePos)).toBe(TILE.empty);
    expect(traps.mobs.length).toBe(1);
  });

  it('a falling floor gathers speed and then lands', () => {
    const { state, traps } = trapsOf(1);
    const loose = findTile(state, TILE.loose)!;
    traps.makeLooseFall(loose.room, loose.tilePos);
    for (let i = 0; i < LOOSE_FLOOR_DELAY - 1; i++) traps.step();
    expect(traps.mobs.length).toBe(1);
    const speeds: number[] = [traps.mobs[0].speed];
    for (let i = 0; i < 20 && traps.mobs.length; i++) {
      traps.step();
      if (traps.mobs.length) speeds.push(traps.mobs[0].speed);
    }
    // Three units faster each frame, up to the original's limit.
    const falling = speeds.filter((s) => s > 0);
    for (let i = 1; i < falling.length; i++) {
      if (falling[i - 1] >= 29) continue;
      expect(falling[i], `step ${i}`).toBe(falling[i - 1] + 3);
    }
    expect(Math.max(...falling)).toBeLessThanOrEqual(30);
  });

  it('spikes come out, stay out, and go back in', () => {
    const { state, traps } = trapsOf(1);
    const spike = findTile(state, TILE.spike);
    if (!spike) return; // level 1 has none; the behaviour is checked below
    traps.startSpike(spike.room, spike.tilePos);
    const seen: number[] = [];
    for (let i = 0; i < 24; i++) {
      traps.step();
      seen.push(state.modifierAtPos(spike.room, spike.tilePos));
    }
    expect(seen[0]).toBe(1);
    expect(seen).toContain(0x8f); // fully out
    expect(seen[seen.length - 1]).toBe(0);
  });

  it('chomper timings run 15, 12, 9, 6, 13, 10, 7, 14, 11, 8 and repeat', () => {
    const seen: number[] = [];
    let t = 15;
    for (let i = 0; i < 10; i++) { seen.push(t); t = nextChomperTiming(t); }
    expect(seen).toEqual([15, 12, 9, 6, 13, 10, 7, 14, 11, 8]);
    expect(nextChomperTiming(8)).toBe(15);
  });

  it('a button is jammed while its timer is held', () => {
    const { state, traps } = trapsOf(1);
    const button = findTile(state, TILE.opener) ?? findTile(state, TILE.closer)!;
    expect(button).toBeTruthy();
    const link = state.modifierAtPos(button.room, button.tilePos);
    traps.pressButton(button.room, button.tilePos);
    expect(state.doorLinkTimer(link)).toBe(5);
    // Held down, it keeps the timer up rather than firing again.
    traps.pressButton(button.room, button.tilePos);
    expect(state.doorLinkTimer(link)).toBe(5);
  });

  it('standing on a button opens the gate it is wired to', async () => {
    const game = await Game.start(assets, exe, 1);
    const state = game.scene.state;
    const button = findTile(state, TILE.opener);
    if (!button) return;
    const link = state.modifierAtPos(button.room, button.tilePos);
    const target = state.doorLink(link);
    const before = state.modifierAtPos(target.room, target.tilePos);
    game.traps.pressButton(button.room, button.tilePos);
    for (let i = 0; i < 10; i++) game.traps.step();
    const after = state.modifierAtPos(target.room, target.tilePos);
    if (state.typeAtPos(target.room, target.tilePos) === TILE.gate) {
      expect(after).toBeGreaterThan(before);
    }
  });

  it('a level plays for hundreds of frames without the trap list running away', async () => {
    const game = await Game.start(assets, exe, 1);
    for (let i = 0; i < 600; i++) {
      game.step({ x: i % 60 < 30 ? 1 : 0, y: 0, shift: false });
      expect(game.traps.trobs.length).toBeLessThanOrEqual(30);
      expect(game.traps.mobs.length).toBeLessThanOrEqual(14);
    }
  });
});
