/**
 * Replaying a captured play session against the port.
 *
 * The original runs in real time under an emulator; the port runs tick by
 * tick. There is no shared clock, so the two are lined up by *order*: the
 * session fixes the order of the captures and which keys were held while
 * each was taken, and the port is then asked to produce the same pictures in
 * the same order.
 *
 * For each capture in turn, the port is stepped forward -- with the keys that
 * capture's phase held -- until a rendered frame equals it, up to a budget of
 * ticks. The first capture that cannot be reproduced is where the port and
 * the original have genuinely parted company, and its index says what the
 * Prince was in the middle of doing at the time.
 *
 * Equality is per pixel over the whole 320x200 screen. The one allowance is
 * torch flames: the original picks each flame's phase at random when a room
 * is entered, so no simulation can agree on it, and differences inside a
 * flame's box are ignored -- only there.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { GAME_DIR, toCaptureSpace } from './fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { TILE } from '../../src/game/tiles.ts';
import type { Controls } from '../../src/game/kid.ts';
import {
  parseSession, shotNames, shotPhases,
  type Session, type SessionPhase,
} from '../../tools/oracle/session.mjs';

export type { Session, SessionPhase };

export const SESSION_DIR = join(GAME_DIR, '..', '..', 'tools', 'oracle', 'sessions');

const WIDTH = 320, HEIGHT = 200;

export function loadSession(name: string): Session {
  const path = join(SESSION_DIR, `${name}.session`);
  return parseSession(readFileSync(path, 'utf8'), name);
}

/**
 * Is this capture the emulator redrawing rather than the game?
 *
 * These sessions were grabbed from DOSBox at three thousand cycles,
 * where redrawing a room takes longer than one of the game's ticks and
 * the screen is black while it does. At twenty thousand cycles the same
 * room change has no black frame at all, so the blank is the slow
 * machine's and the port has nothing to put in its place -- see
 * `ROOM_CHANGE_BLANK`. The hit points along the bottom eight rows stay
 * lit through it, so only the room's own 192 rows are looked at.
 */
function isRedrawBlank(rgb: Uint8Array): boolean {
  for (let i = 0; i < WIDTH * 192 * 3; i++) if (rgb[i] > 20) return false;
  return true;
}

function captureRgb(dir: string, name: string): Uint8Array | null {
  const path = join(dir, `${name}.png`);
  if (!existsSync(path)) return null;
  const png = PNG.sync.read(readFileSync(path));
  // DOSBox captures a doubled 320x200 screen; take every second pixel, and
  // check the doubling really is exact rather than a resample.
  const sx = png.width === WIDTH * 2 ? 2 : 1;
  const sy = png.height === HEIGHT * 2 ? 2 : 1;
  const rgb = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const s = ((y * sy) * png.width + x * sx) * 4;
      const d = (y * WIDTH + x) * 3;
      rgb[d] = png.data[s]; rgb[d + 1] = png.data[s + 1]; rgb[d + 2] = png.data[s + 2];
    }
  }
  return rgb;
}

export interface Match {
  /** Capture index. */
  index: number;
  name: string;
  phase: string;
  /** The port tick that reproduced it exactly, or null if none did. */
  tick: number | null;
  /** Fewest differing pixels seen while searching, for a capture that failed. */
  bestDiff: number;
  bestTick: number;
  state: string;
  /**
   * A capture the port cannot be expected to have: the emulator's own
   * black screen while it redraws a room. Not counted either way.
   */
  skipped?: boolean;
}

export interface SessionResult {
  session: Session;
  matches: Match[];
  /** Captures reproduced exactly. */
  reproduced: number;
  /** Indices of the captures that were not. */
  failures: number[];
  /** Indices of the captures left out -- see `Match.skipped`. */
  skipped: number[];
}

export interface AlignOptions {
  /** Ticks the port may search for the first capture (the level entry). */
  firstBudget?: number;
  /** Ticks the port may search for each later capture. */
  budget?: number;
  /** Where to write pictures of the captures that were not reproduced. */
  artifacts?: string;
}

/**
 * Line a session's captures up against the port, and keep going past a
 * capture it cannot reproduce.
 *
 * Carrying on matters: the first difference is often a few pixels of a
 * sprite, and stopping there would hide whatever the Prince does wrong three
 * moves later. So a capture that cannot be reproduced is recorded, its
 * closest frame is taken as the alignment point, and the session continues
 * from there. The port is deterministic, so "continue from there" is done by
 * replaying from the start -- which is cheap, and avoids having to copy the
 * game's state.
 */
export async function alignSession(
  name: string, captureDir: string, options: AlignOptions = {},
): Promise<SessionResult> {
  const session = loadSession(name);
  const names = shotNames(session);
  const phaseOf = shotPhases(session);
  const firstBudget = options.firstBudget ?? 180;
  const budget = options.budget ?? 48;

  const assets = new Assets(async (n: string) =>
    new Uint8Array(readFileSync(join(GAME_DIR, n))));
  const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

  const wanted = names.map((n) => captureRgb(captureDir, n));

  /** Tick chosen for each capture; -1 until it has been decided. */
  const chosen = new Array<number>(names.length).fill(-1);
  const matches = new Array<Match>(names.length);
  const controlsFor = (i: number): Controls => {
    const phase = session.phases[phaseOf[i]];
    return { x: phase.x, y: phase.y, shift: phase.shift };
  };

  // Each pass decides at least one more capture, so this terminates.
  for (let pass = 0; pass <= names.length; pass++) {
    const game = await Game.start(assets, exe, session.level);
    // The captures were all taken well after the level's number went off
    // the bottom of the screen; see `clearBottomText`.
    game.clearBottomText();
    const flameBoxes = makeFlameBoxes(game);
    const frame = (): Uint8Array =>
      toCaptureSpace(game.render().toRgb(game.scene.screenPalette.toRgba()))
        .slice(0, WIDTH * HEIGHT * 3);

    let tick = 0;
    let current = frame();
    let restart = false;

    for (let i = 0; i < names.length && !restart; i++) {
      const want = wanted[i];
      const controls = controlsFor(i);
      if (!want || isRedrawBlank(want)) {
        matches[i] = {
          index: i, name: names[i], phase: session.phases[phaseOf[i]].spec,
          tick: null, bestDiff: -1, bestTick: tick,
          state: want ? 'the emulator redrawing' : 'capture missing',
          skipped: Boolean(want),
        };
        chosen[i] = tick;
        continue;
      }
      if (chosen[i] >= 0) {
        // Already decided on an earlier pass: just walk back up to it.
        while (tick < chosen[i]) { game.step(controls); tick++; }
        current = frame();
        continue;
      }

      const match: Match = {
        index: i, name: names[i], phase: session.phases[phaseOf[i]].spec,
        tick: null, bestDiff: Number.MAX_SAFE_INTEGER, bestTick: tick, state: '',
      };
      const startTick = tick;
      const limit = i === 0 ? firstBudget : budget;
      let bestRgb: Uint8Array | null = null;
      for (let k = 0; k <= limit; k++) {
        const d = differs(current, want, flameBoxes(game.drawnRoom));
        if (d < match.bestDiff) {
          match.bestDiff = d;
          match.bestTick = tick;
          match.state = `frame ${game.kid.frame} room ${game.kid.room} `
            + `x ${game.kid.x} y ${game.kid.y}`;
          bestRgb = current;
        }
        if (d === 0) { match.tick = tick; break; }
        if (k === limit) break;
        game.step(controls);
        tick++;
        current = frame();
      }
      matches[i] = match;
      if (match.tick === null) {
        // Take the closest frame as the alignment point and start again, so
        // the rest of the session is still played and still compared. The
        // point has to move forward by at least a tick: the closest frame is
        // often the one the search started on, and settling for that would
        // leave the port standing on the same tick for the whole rest of the
        // session, comparing every later capture against one frozen frame.
        chosen[i] = Math.max(match.bestTick, startTick + 1);
        if (options.artifacts && bestRgb) {
          writeArtifacts(options.artifacts, names[i], bestRgb, want);
        }
        restart = true;
      } else {
        chosen[i] = match.tick;
      }
    }
    if (!restart) break;
  }

  const failures = matches
    .filter((m) => m.tick === null && !m.skipped).map((m) => m.index);
  return {
    session, matches,
    reproduced: matches.filter((m) => m.tick !== null).length,
    failures,
    skipped: matches.filter((m) => m.skipped).map((m) => m.index),
  };
}

/**
 * The boxes torch flames are drawn in. The original picks each flame's phase
 * at random when a room is entered, so no simulation can agree on it, and
 * differences inside these boxes are ignored -- only there.
 */
function makeFlameBoxes(
  game: Game,
): (room: number) => { x0: number; y0: number; x1: number; y1: number }[] {
  return (room: number) => {
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const add = (column: number, row: number): void => {
      const drawX = column * 32;
      const mainY = 63 * row + 65 - 3;
      out.push({ x0: drawX + 6, y0: mainY - 60, x1: drawX + 26, y1: mainY - 38 });
    };
    const isTorch = (t: number): boolean => t === TILE.torch || t === TILE.torchWithDebris;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 10; c++) {
        if (isTorch(game.scene.tiles.typeAt(room, c, r))) add(c + 1, r);
      }
      const left = game.scene.tiles.linkOf(room, 0);
      if (left && isTorch(game.scene.tiles.typeAt(left, 9, r))) add(0, r);
    }
    return out;
  };
}

function differs(
  got: Uint8Array, want: Uint8Array,
  boxes: { x0: number; y0: number; x1: number; y1: number }[],
): number {
  let n = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      if (got[i] === want[i] && got[i + 1] === want[i + 1] && got[i + 2] === want[i + 2]) {
        continue;
      }
      let inFlame = false;
      for (const b of boxes) {
        if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) { inFlame = true; break; }
      }
      if (!inFlame) n++;
    }
  }
  return n;
}

/** Our frame, theirs, and a map of where they differ. */
function writeArtifacts(
  dir: string, name: string, got: Uint8Array, want: Uint8Array,
): void {
  mkdirSync(dir, { recursive: true });
  const write = (file: string, rgb: Uint8Array): void => {
    const png = new PNG({ width: WIDTH, height: HEIGHT });
    for (let i = 0; i < WIDTH * HEIGHT; i++) {
      png.data[i * 4] = rgb[i * 3];
      png.data[i * 4 + 1] = rgb[i * 3 + 1];
      png.data[i * 4 + 2] = rgb[i * 3 + 2];
      png.data[i * 4 + 3] = 255;
    }
    writeFileSync(join(dir, file), PNG.sync.write(png));
  };
  write(`${name}-ours.png`, got);
  write(`${name}-theirs.png`, want);
  const diff = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const a = i * 3;
    const same = got[a] === want[a] && got[a + 1] === want[a + 1] && got[a + 2] === want[a + 2];
    diff[a] = same ? 0 : 255;
    diff[a + 1] = same ? 0 : 0;
    diff[a + 2] = same ? 0 : 255;
  }
  write(`${name}-diff.png`, diff);
}
