/**
 * The things in a room that move on their own: gates, buttons, spikes,
 * chompers, loose floors, torches, potions.
 *
 * The original keeps a small list of "tiles currently doing something" and
 * steps every entry once a frame, each tile's behaviour driven by its own
 * modifier byte. A tile joins the list when something starts it -- the
 * Prince stepping on a button, a chomper being woken by his arrival -- and
 * leaves it when it settles. Loose floors that have come away are a second
 * list, of falling objects.
 */
import type { LevelState } from './level-state.ts';
import { TILE } from './tiles.ts';
import { Prng } from './random.ts';

/** How a tile in the list is being animated. Negative means "finished". */
export interface Trob {
  room: number;
  tilePos: number;
  type: number;
}

/** A loose floor that has come away and is falling. */
export interface Mob {
  /** Horizontal position in quarter-tiles, as the original stores it. */
  xh: number;
  y: number;
  room: number;
  speed: number;
  type: number;
  row: number;
}

export const GATE_CLOSE_SPEEDS = [0, 0, 0, 20, 40, 60, 80, 100, 120] as const;
const DOOR_DELTA = [-1, 4, 4] as const;
const LEVEL_DOOR_CLOSE_SPEEDS = [0, 5, 17, 99, 0] as const;
const LOOSE_SOUND = [0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0] as const;
const Y_LOOSE_LAND = [2, 65, 128, 191, 254] as const;
const Y_SOMETHING = [-1, 62, 125, 188, 25] as const;

/** The default delay before a loose floor gives way. */
export const LOOSE_FLOOR_DELAY = 11;
export const CHOMPER_SPEED = 15;

export interface TrapEffects {
  sound?(which: number): void;
  /** A falling floor landed on this row of this room. */
  floorCrashed?(room: number, row: number): void;
}

export class Traps {
  readonly trobs: Trob[] = [];
  readonly mobs: Mob[] = [];
  private readonly level: LevelState;
  private readonly prng: Prng;
  private readonly effects: TrapEffects;
  private lastLooseSound = -1;
  /** The room the view is showing; some tiles only animate while visible. */
  drawnRoom = 0;
  /** Where the Prince is, which decides whether chompers keep snapping. */
  kidRoom = 0;
  kidRow = -1;
  kidAlive = -1;
  readonly levelType: number;

  constructor(level: LevelState, prng: Prng, levelType: number, effects: TrapEffects = {}) {
    this.level = level;
    this.prng = prng;
    this.levelType = levelType;
    this.effects = effects;
  }

  // ------------------------------------------------------------- the list

  add(room: number, tilePos: number, type: number): void {
    const found = this.trobs.find((t) => t.tilePos === tilePos && t.room === room);
    if (found) {
      found.type = type;
      return;
    }
    if (this.trobs.length >= 30) return;
    this.trobs.push({ room, tilePos, type });
  }

  /** Step every animated tile once. */
  step(): void {
    for (const trob of this.trobs) this.animate(trob);
    for (let i = this.trobs.length - 1; i >= 0; i--) {
      if (this.trobs[i].type < 0) this.trobs.splice(i, 1);
    }
    this.stepMobs();
  }

  private animate(trob: Trob): void {
    const type = this.level.typeAtPos(trob.room, trob.tilePos);
    let modifier = this.level.modifierAtPos(trob.room, trob.tilePos);
    switch (type) {
      case TILE.torch:
      case TILE.torchWithDebris:
        modifier = this.animateTorch(trob, modifier);
        break;
      case TILE.closer:
      case TILE.opener:
        modifier = this.animateButton(trob, modifier);
        break;
      case TILE.spike:
        modifier = this.animateSpike(trob, modifier);
        break;
      case TILE.loose:
        modifier = this.animateLoose(trob, modifier);
        break;
      case TILE.empty:
        trob.type = -1;
        break;
      case TILE.chomper:
        modifier = this.animateChomper(trob, modifier);
        break;
      case TILE.gate:
        modifier = this.animateGate(trob, modifier);
        break;
      case TILE.levelDoorLeft:
        modifier = this.animateLevelDoor(trob, modifier);
        break;
      case TILE.potion:
        modifier = this.animatePotion(trob, modifier);
        break;
      case TILE.sword:
        modifier = this.animateSword(trob, modifier);
        break;
      default:
        trob.type = -1;
        break;
    }
    this.level.setModifierAtPos(trob.room, trob.tilePos, modifier);
  }

  // --------------------------------------------------------- the tile kinds

  /**
   * A flame picks a new frame at random, mostly moving on by one. Two
   * torches side by side are therefore rarely in step, which is why no
   * simulation can be expected to match a captured frame's flames.
   */
  private animateTorch(trob: Trob, modifier: number): number {
    if (trob.room !== this.drawnRoom
      && !(trob.room === this.level.linkOf(this.drawnRoom, 0) && trob.tilePos % 10 === 9)) {
      trob.type = -1;
      return modifier;
    }
    let next = this.prng.next(255);
    if (next !== modifier) {
      if (next < 9) return next;
      next = modifier;
    }
    next += 1;
    if (next >= 9) next = 0;
    return next;
  }

  private animateButton(trob: Trob, modifier: number): number {
    if (trob.type < 0) return modifier;
    const timer = this.level.doorLinkTimer(modifier) - 1;
    this.level.setDoorLinkTimer(modifier, timer);
    if (timer < 2) trob.type = -1;
    return modifier;
  }

  /** Spikes come out, stay out a while, then go back in. */
  private animateSpike(trob: Trob, modifier: number): number {
    if (trob.type < 0) return modifier;
    if (modifier === 0xff) return modifier; // a spike that is switched off
    if (modifier & 0x80) {
      modifier = (modifier - 1) & 0xff;
      if (modifier & 0x7f) return modifier;
      return 6;
    }
    modifier += 1;
    if (modifier === 5) return 0x8f;
    if (modifier === 9) {
      trob.type = -1;
      return 0;
    }
    return modifier;
  }

  private animateChomper(trob: Trob, modifier: number): number {
    if (trob.type >= 0) {
      const blood = modifier & 0x80;
      let frame = (modifier & 0x7f) + 1;
      if (frame > CHOMPER_SPEED) frame = 1;
      modifier = blood | frame;
      if (frame === 2) this.effects.sound?.(SOUND.chomper);
      const leftRoom = trob.room !== this.drawnRoom;
      const leftRow = Math.floor(trob.tilePos / 10) !== this.kidRow;
      const notHere = this.kidAlive >= 0 && blood === 0;
      if ((leftRoom || leftRow || notHere) && (modifier & 0x7f) >= 6) trob.type = -1;
    }
    return modifier;
  }

  /**
   * A gate's modifier is how far it is open, 0 to 188. Type 0 is closing,
   * 1 opening, 2 opening permanently, 3..8 slamming shut at rising speed.
   */
  private animateGate(trob: Trob, modifier: number): number {
    if (trob.type < 0) return modifier;
    if (trob.type >= 3) {
      if (trob.type < 8) trob.type += 1;
      const next = modifier - GATE_CLOSE_SPEEDS[trob.type];
      if (next < 0) {
        trob.type = -1;
        this.effects.sound?.(SOUND.gateClosingFast);
        return 0;
      }
      return next;
    }
    if (modifier === 0xff) {
      trob.type = -1;
      return modifier;
    }
    modifier = (modifier + DOOR_DELTA[trob.type]) & 0xff;
    if (trob.type === 0) {
      if (modifier === 0) {
        trob.type = -1;
        this.effects.sound?.(SOUND.gateStop);
      } else if (modifier < 188 && (modifier & 3) === 3) {
        this.effects.sound?.(SOUND.gateClosing);
      }
      return modifier;
    }
    if (modifier < 188) {
      if ((modifier & 7) === 0) this.effects.sound?.(SOUND.gateOpening);
      return modifier;
    }
    if (trob.type < 2) {
      trob.type = 0; // hold open a moment, then close
      this.effects.sound?.(SOUND.gateStop);
      return 238;
    }
    trob.type = -1;
    return 0xff; // stay open for good
  }

  private animateLevelDoor(trob: Trob, modifier: number): number {
    if (trob.type < 0) return modifier;
    if (trob.type === 3) {
      // opening
      modifier += 1;
      if (modifier >= 43) {
        trob.type = -1;
        return 43;
      }
      return modifier;
    }
    const speed = LEVEL_DOOR_CLOSE_SPEEDS[Math.min(trob.type, 4)];
    const next = modifier - speed;
    if (next <= 0) {
      trob.type = -1;
      return 0;
    }
    return next;
  }

  private animatePotion(trob: Trob, modifier: number): number {
    if (trob.type < 0 || trob.room !== this.drawnRoom) {
      trob.type = -1;
      return modifier;
    }
    const kind = modifier & 0xf8;
    let bubble = (modifier & 7) + 1;
    if (bubble >= 8) bubble = 1;
    return kind | bubble;
  }

  private animateSword(trob: Trob, modifier: number): number {
    if (trob.room !== this.drawnRoom) trob.type = -1;
    return modifier;
  }

  /**
   * A loose floor shakes when something lands on it, and after a short delay
   * comes away and falls.
   */
  private animateLoose(trob: Trob, modifier: number): number {
    if (trob.type < 0) return modifier;
    modifier = (modifier + 1) & 0xff;
    if (modifier & 0x80) {
      // only shaking, not about to fall
      if (modifier >= 0x84) {
        trob.type = -1;
        this.looseShake(0, true);
        return 0;
      }
      this.looseShake(modifier, false);
      return modifier;
    }
    if (modifier < LOOSE_FLOOR_DELAY) {
      this.looseShake(modifier, false);
      return modifier;
    }
    // it gives way
    const room = trob.room;
    const tilePos = trob.tilePos;
    const left = this.removeLoose(room, tilePos);
    trob.type = -1;
    const row = Math.floor(tilePos / 10);
    this.mobs.push({
      xh: (tilePos % 10) << 2,
      y: Y_LOOSE_LAND[row + 1],
      room,
      speed: 0,
      type: 0,
      row,
    });
    return left;
  }

  private looseShake(modifier: number, force: boolean): void {
    if (!force && !LOOSE_SOUND[modifier & 0x7f]) return;
    let id: number;
    do {
      id = this.prng.next(2) + SOUND.looseShake1;
    } while (id === this.lastLooseSound);
    this.prng.next(2); // the original burns a number here
    this.lastLooseSound = id;
    this.effects.sound?.(id);
  }

  /** The tile left behind depends on whether the level is dungeon or palace. */
  private removeLoose(room: number, tilePos: number): number {
    this.level.setTypeAtPos(room, tilePos, TILE.empty);
    return this.levelType;
  }

  // ------------------------------------------------------- falling floors

  private stepMobs(): void {
    for (const mob of this.mobs) this.moveMob(mob);
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      if (this.mobs[i].speed === -1) this.mobs.splice(i, 1);
    }
  }

  private moveMob(mob: Mob): void {
    if (mob.type === 0) this.moveLoose(mob);
    if (mob.speed <= 0) mob.speed += 1;
  }

  private moveLoose(mob: Mob): void {
    if (mob.speed < 0) return;
    if (mob.speed < 29) mob.speed += 3;
    mob.y += mob.speed;
    if (mob.room === 0) {
      if (mob.y >= 210) mob.speed = -2;
      return;
    }
    if (mob.y < 226 && Y_SOMETHING[mob.row + 1] <= mob.y) {
      const column = mob.xh >> 2;
      const type = this.level.typeAt(mob.room, column, mob.row);
      if (type === TILE.loose) {
        // knocks the floor below away too
        this.removeLoose(mob.room, mob.row * 10 + column);
      }
      if (type === TILE.empty || type === TILE.loose) {
        this.mobDownARow(mob);
        return;
      }
      this.effects.sound?.(SOUND.tileCrashing);
      this.knock(mob.room, mob.row);
      mob.y = Y_SOMETHING[mob.row + 1];
      mob.speed = -2;
      this.leaveRubble(mob.room, column, mob.row);
      this.effects.floorCrashed?.(mob.room, mob.row);
    }
  }

  private mobDownARow(mob: Mob): void {
    mob.row += 1;
    if (mob.row >= 3) {
      mob.row = 0;
      mob.y -= 189;
      mob.room = this.level.linkOf(mob.room, 3);
    }
  }

  /**
   * A floor that has smashed leaves its rubble where it landed. The tile set
   * is built for it: 14 is a floor with rubble on it and 30 is a torch with
   * rubble on it, which is the pair the original turns 1 and 19 into. Level
   * 1 ships with a tile 14 under its first loose floor, from a fall that
   * happened before the player arrives.
   */
  private leaveRubble(room: number, column: number, row: number): void {
    const type = this.level.typeAt(room, column, row);
    if (type === TILE.floor) this.level.setType(room, column, row, TILE.debris);
    else if (type === TILE.torch) this.level.setType(room, column, row, TILE.torchWithDebris);
  }

  /** A crash shakes every loose floor on the row. */
  private knock(room: number, row: number): void {
    for (let column = 0; column < 10; column++) {
      if (this.level.typeAt(room, column, row) === TILE.loose) {
        this.makeLooseShake(room, row * 10 + column);
      }
    }
  }

  // ------------------------------------------------------------- triggers

  /** The Prince stood on a button. */
  pressButton(room: number, tilePos: number, buttonType = 0, modifier = -1): void {
    const type = buttonType || this.level.typeAtPos(room, tilePos);
    const link = modifier >= 0 ? modifier : this.level.modifierAtPos(room, tilePos);
    const timer = this.level.doorLinkTimer(link);
    if (timer === 0x1f) return; // jammed
    this.level.setDoorLinkTimer(link, 5);
    if (timer < 2) {
      this.add(room, tilePos, 1);
      this.effects.sound?.(SOUND.buttonPressed);
    }
    this.runTriggerList(link, type);
  }

  private runTriggerList(index: number, buttonType: number): void {
    for (let i = index; i < 256; i++) {
      const link = this.level.doorLink(i);
      const target = this.level.typeAtPos(link.room, link.tilePos);
      const result = this.triggerOne(target, link.room, link.tilePos, buttonType);
      if (result >= 0) this.add(link.room, link.tilePos, result);
      if (!link.hasNext) break;
    }
  }

  private triggerOne(
    target: number, room: number, tilePos: number, buttonType: number,
  ): number {
    if (target === TILE.gate) return this.triggerGate(room, tilePos, buttonType);
    if (target === TILE.levelDoorLeft) {
      return this.level.modifierAtPos(room, tilePos) !== 0 ? -1 : 1;
    }
    return -1;
  }

  private triggerGate(room: number, tilePos: number, buttonType: number): number {
    const modifier = this.level.modifierAtPos(room, tilePos);
    if (buttonType === TILE.opener) {
      if (modifier === 0xff) return -1;
      if (modifier >= 188) {
        this.level.setModifierAtPos(room, tilePos, 238);
        return -1;
      }
      this.level.setModifierAtPos(room, tilePos, (modifier + 3) & 0xfc);
      return 1;
    }
    if (buttonType === TILE.debris) {
      if (modifier < 188) return 2; // open for good
      this.level.setModifierAtPos(room, tilePos, 0xff);
      return -1;
    }
    return modifier !== 0 ? 3 : -1; // slam shut, or already shut
  }

  /** Something put weight on a loose floor. */
  makeLooseFall(room: number, tilePos: number, modifier = 1): void {
    // A loose floor marked "solid" in the level data never falls.
    if ((this.level.rawAtPos(room, tilePos) & 0x20) !== 0) return;
    const current = (this.level.modifierAtPos(room, tilePos) << 24) >> 24;
    if (current > 0) return;
    this.level.setModifierAtPos(room, tilePos, modifier);
    this.add(room, tilePos, 0);
  }

  private makeLooseShake(room: number, tilePos: number): void {
    const current = (this.level.modifierAtPos(room, tilePos) << 24) >> 24;
    if (current !== 0) return;
    this.level.setModifierAtPos(room, tilePos, 0x80);
    this.add(room, tilePos, 0);
  }

  /** Wake the chompers on the row a character has just arrived on. */
  startChompers(room: number, row: number): void {
    if (row < 0 || row > 2) return;
    let timing = 15;
    for (let column = 0; column < 10; column++) {
      if (this.level.typeAt(room, column, row) !== TILE.chomper) continue;
      const tilePos = row * 10 + column;
      const modifier = this.level.modifierAtPos(room, tilePos);
      const phase = modifier & 0x7f;
      if (phase !== 0 && phase < 6) continue;
      this.level.setModifierAtPos(room, tilePos, timing | (modifier & 0x80));
      this.add(room, tilePos, 1);
      timing = nextChomperTiming(timing);
    }
  }

  /** Spikes come out when something walks over them. */
  startSpike(room: number, tilePos: number): void {
    const old = (this.level.modifierAtPos(room, tilePos) << 24) >> 24;
    if (old > 0) return;
    if (old === 0) {
      this.add(room, tilePos, 1);
      this.effects.sound?.(SOUND.spikes);
      return;
    }
    if (old !== -1) this.level.setModifierAtPos(room, tilePos, 0x8f);
  }

  /** 0 harmless, 1 out and deadly, 2 coming out and deadly to a runner. */
  spikeHarm(room: number, tilePos: number): number {
    const modifier = (this.level.modifierAtPos(room, tilePos) << 24) >> 24;
    if (modifier === 0 || modifier === -1) return 0;
    if (modifier < 0) return 1;
    if (modifier < 5) return 2;
    return 0;
  }

  /** Start a level's exit door opening. */
  openLevelDoor(room: number, tilePos: number): void {
    this.level.setModifierAtPos(room, tilePos, 43);
    this.add(room, tilePos, 3);
  }
}

/** 15, 12, 9, 6, 13, 10, 7, 14, 11, 8, and round again. */
export function nextChomperTiming(timing: number): number {
  let next = timing - 3;
  if (next < 6) next += 10;
  return next;
}

/** Sound numbers, as the original indexes them. */
export const SOUND = {
  falling: 1,
  tileCrashing: 2,
  buttonPressed: 3,
  gateClosing: 4,
  gateOpening: 5,
  gateClosingFast: 6,
  gateStop: 7,
  bumped: 8,
  grab: 9,
  softLand: 17,
  drink: 18,
  looseShake1: 20,
  looseShake2: 21,
  looseShake3: 22,
  footstep: 23,
  mediumLand: 16,
  chomper: 47,
  spikes: 49,
} as const;
