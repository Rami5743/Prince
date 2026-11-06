/**
 * One playable level: the scene it draws from, the Prince, and a frame step.
 */
import type { Assets } from '../render/assets.ts';
import { Surface } from '../render/surface.ts';
import { RoomRenderer, type CharacterDraw } from '../render/room.ts';
import { buildLevelScene, type LevelScene } from './scene.ts';
import { readExeTables, type ExeTables } from './exe-tables.ts';
import {
  newCharacter, placeCharacter, placeSword, type CharacterState,
} from './character.ts';
import { stepKid, enterLevel, type Controls, type KidContext, type TrapHooks } from './kid.ts';
import type { World } from './physics.ts';
import { ControlLatch } from './control-latch.ts';
import { TILE_TYPE_MASK, ROOM_COLUMNS } from './tiles.ts';
import { toScreenX } from './geometry.ts';
import { Traps, type TrapEffects } from './traps.ts';
import { Prng } from './random.ts';
import { SWORD_SEQ, strikeLands, withinReach, isBlocking } from './sword.ts';
import { startSequence } from './sequence.ts';
import {
  newGuard, guardsFromLevel, positionGuards, enterGuard, leaveGuard, guardDraw,
  guardFrame, stepGuard, NO_DIRECTION, type GuardState, type GuardsData,
} from './guard.ts';

export interface GameOptions {
  /** Which video mode's artwork to use; the port draws the VGA set. */
  readonly prefix?: string;
  readonly effects?: TrapEffects;
}

export class Game {
  readonly scene: LevelScene;
  readonly tables: ExeTables;
  readonly kid: CharacterState;
  readonly surface = new Surface();
  /** The room the view is showing. */
  drawnRoom: number;
  hitPoints: number;
  maxHitPoints: number;
  readonly traps: Traps;
  readonly prng = new Prng();
  readonly guard: GuardState = newGuard();
  readonly guards: GuardsData;
  private readonly renderer: RoomRenderer;
  private readonly ctx: KidContext;

  readonly levelNumber: number;

  private readonly effects: TrapEffects;

  private constructor(
    scene: LevelScene, tables: ExeTables, levelNumber: number, effects: TrapEffects = {},
  ) {
    this.levelNumber = levelNumber;
    this.effects = effects;
    this.scene = scene;
    this.tables = tables;
    this.kid = newCharacter();
    this.hitPoints = scene.constants.startHitPoints;
    this.maxHitPoints = scene.constants.startHitPoints;

    const world: World = {
      tileAt: (room, column, row) => scene.tiles.typeAt(room, column, row) & TILE_TYPE_MASK,
      modifierAt: (room, column, row) => scene.tiles.modifierAt(room, column, row),
      linkOf: (room, dir) => scene.tiles.linkOf(room, dir),
      levelEdgeHitTile: scene.constants.levelEdgeHitTile,
    };
    this.prng.set(1);
    this.traps = new Traps(scene.state, this.prng, scene.options.levelType, effects);
    const trapHooks: TrapHooks = {
      pressButton: (room, tilePos) => this.traps.pressButton(room, tilePos),
      makeLooseFall: (room, tilePos) => this.traps.makeLooseFall(room, tilePos),
      startChompers: (room, row) => this.traps.startChompers(room, row),
      chomperHarm: (room, tilePos) => this.traps.chomperHarm(room, tilePos),
      bloodyChomper: (room, tilePos) => this.traps.bloodyChomper(room, tilePos),
      startSpike: (room, tilePos) => this.traps.startSpike(room, tilePos),
      spikeHarm: (room, tilePos) => this.traps.spikeHarm(room, tilePos),
    };
    this.ctx = {
      tables,
      world,
      spriteWidth: (image) => scene.chtabs.kid?.images[image + 1]?.width ?? 0,
      controls: { x: 0, y: 0, shift: false },
      traps: trapHooks,
      latch: new ControlLatch(),
      damage: (amount) => this.damage(amount),
      opponent: () => (this.guard.direction === NO_DIRECTION ? null : this.guard),
    };
    enterLevel(
      this.kid, scene.level.startRoom, scene.level.startPos, scene.level.startDir,
      this.ctx, levelNumber,
    );
    this.drawnRoom = this.kid.room;
    this.traps.drawnRoom = this.drawnRoom;
    this.guards = guardsFromLevel(scene.level.guards);
    positionGuards(scene.state, this.guards);
    this.enterRoom(this.drawnRoom);
    this.renderer = new RoomRenderer(scene.chtabs, scene.tiles, scene.options);
  }

  static async start(
    assets: Assets, exe: Uint8Array, levelNumber: number, options: GameOptions = {},
  ): Promise<Game> {
    const scene = await buildLevelScene(assets, exe, levelNumber, options.prefix ?? 'V');
    return new Game(scene, readExeTables(exe), levelNumber, options.effects);
  }

  /**
   * Advance one frame of the game: first the room reacts, then the Prince
   * moves, which is the order the original uses.
   */
  step(controls: Controls): void {
    const wasDrawing = this.drawnRoom;
    this.traps.drawnRoom = this.drawnRoom;
    this.traps.kidRoom = this.kid.room;
    this.traps.kidRow = this.kid.currentRow;
    this.traps.kidAlive = this.kid.alive;
    this.traps.step();
    stepKid(this.kid, controls, this.ctx);
    stepGuard(this.guard, {
      tables: this.tables,
      effects: this.effects,
      kidRoom: this.kid.room,
      kidRow: this.kid.currentRow,
      kidX: this.kid.x,
      kid: this.kid,
    });
    this.resolveSwordplay();
    if (this.kid.room !== 0) this.drawnRoom = this.kid.room;
    if (this.drawnRoom !== wasDrawing) this.enterRoom(this.drawnRoom);
  }

  /**
   * A lunge that reaches an opponent who is not blocking costs him a hit
   * point, and the last of them kills him.
   *
   * Both characters are stepped before this runs, so each has already
   * reached this frame's pose: the one lunging is on the contact frame or
   * it is not, and the other is holding his blade up or he is not.
   */
  private resolveSwordplay(): void {
    if (this.guard.direction === NO_DIRECTION) return;
    this.tryHit(this.kid, this.guard);
    this.tryHit(this.guard, this.kid);
  }

  private tryHit(attacker: CharacterState, defender: CharacterState): void {
    if (attacker.alive >= 0 || defender.alive >= 0) return;
    if (!strikeLands(attacker) || !withinReach(attacker, defender)) return;
    if (isBlocking(defender)) return; // parried
    if (defender === this.kid) {
      const dead = this.damage(1);
      startSequence(defender, dead ? SWORD_SEQ.kidDie : SWORD_SEQ.stabbed, this.tables);
      if (dead) defender.alive = 0;
      return;
    }
    this.guard.hitPoints = Math.max(0, this.guard.hitPoints - 1);
    const dead = this.guard.hitPoints === 0;
    startSequence(defender, dead ? SWORD_SEQ.dropDead : SWORD_SEQ.stabbed, this.tables);
    if (dead) defender.alive = 0;
  }

  /** Hurt the Prince. Returns true if that was the last of his hit points. */
  damage(amount: number): boolean {
    this.hitPoints = Math.max(0, this.hitPoints - amount);
    return this.hitPoints === 0;
  }

  /** True once the Prince is dead and the level is waiting to be restarted. */
  get isDead(): boolean {
    return this.hitPoints === 0 || this.kid.alive >= 0;
  }

  /**
   * Put the level back as it was and the Prince back at its start, which is
   * what the original does after a death.
   */
  async restart(assets: Assets, exe: Uint8Array): Promise<Game> {
    return Game.start(assets, exe, this.levelNumber, { effects: this.effects });
  }

  /** Show a different room without playing: for looking around. */
  showRoom(room: number): void {
    if (room === this.drawnRoom) return;
    this.drawnRoom = room;
    this.enterRoom(room);
  }

  /**
   * Show a different room: the guard of the room being left goes back into
   * the level, the guard of the room being entered comes out of it, and the
   * new room's torches and exit door start up.
   */
  private enterRoom(room: number): void {
    leaveGuard(this.guard, this.guards);
    enterGuard(this.guard, room, this.guards, {
      tables: this.tables,
      guardType: this.scene.guardType,
      levelGuardHitPoints: this.scene.constants.guardHitPoints[this.levelNumber] ?? 0,
    });
    this.applyGuardColour();
    this.traps.drawnRoom = room;
    this.startRoomTiles(room);
  }

  /**
   * A guard's clothes are recoloured per room, from the seven palettes the
   * game keeps in PRINCE.DAT. Colour 0 leaves the sprite's own colours alone.
   */
  private applyGuardColour(): void {
    const set = this.scene.chtabs.guard;
    const palettes = this.scene.guardPalettes;
    if (!set) return;
    if (!palettes || this.guard.colour === 0) {
      this.scene.screenPalette.loadBlock(set.paletteBase, set.palette.vga);
      return;
    }
    const at = (this.guard.colour - 1) * 0x30;
    const colours = [];
    for (let i = 0; i < 16; i++) {
      colours.push({
        r: palettes[at + i * 3] ?? 0,
        g: palettes[at + i * 3 + 1] ?? 0,
        b: palettes[at + i * 3 + 2] ?? 0,
      });
    }
    this.scene.screenPalette.loadBlock(set.paletteBase, colours);
  }

  /**
   * Entering a room sets its torches going and, on a level that is not the
   * one the Prince started on, its exit door. The original does this when it
   * draws a room for the first time.
   */
  private startRoomTiles(room: number): void {
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 10; column++) {
        const type = this.scene.state.typeAt(room, column, row);
        const tilePos = row * 10 + column;
        if (type === 19 || type === 30) {
          this.scene.state.setModifierAtPos(room, tilePos, this.prng.next(8));
          this.traps.add(room, tilePos, 1);
        } else if (type === 10 || type === 22) {
          this.traps.add(room, tilePos, 1);
        }
      }
      const left = this.scene.state.linkOf(room, 0);
      if (left) {
        const type = this.scene.state.typeAt(left, 9, row);
        if (type === 19 || type === 30) {
          this.scene.state.setModifierAtPos(left, row * 10 + 9, this.prng.next(8));
          this.traps.add(left, row * 10 + 9, 1);
        }
      }
    }
  }

  /** What to draw for the Prince, if he is in the room being shown. */
  kidDraw(): CharacterDraw | null {
    if (this.kid.room !== this.drawnRoom) return null;
    const frame = this.tables.frameTableKid[this.kid.frame];
    if (!frame) return null;
    return placeCharacter(this.kid, frame);
  }

  render(): Surface {
    this.surface.clear();
    const characters: CharacterDraw[] = [];

    if (this.guard.room === this.drawnRoom && this.guard.direction !== NO_DIRECTION) {
      const draw = guardDraw(this.guard, this.tables);
      if (draw) characters.push(draw);
      const frame = guardFrame(this.guard, this.tables);
      // A living guard always has his sword out.
      if (frame && this.guard.alive < 0) {
        const sword = placeSword(this.guard, frame, this.tables.swordTable, toScreenX);
        if (sword) characters.push(sword);
      }
    }

    const kid = this.kidDraw();
    if (kid) characters.push(kid);
    const kidFrame = this.tables.frameTableKid[this.kid.frame];
    if (kid && kidFrame && this.kid.sword !== 0) {
      const sword = placeSword(this.kid, kidFrame, this.tables.swordTable, toScreenX);
      if (sword) characters.push(sword);
    }

    this.renderer.render(this.surface, this.drawnRoom, characters);
    this.drawStatusBar();
    return this.surface;
  }

  /**
   * The strip below the room. The original draws the Prince's hit points
   * there as small sprites from his own group: a full one for each point he
   * has, an empty one for each he has lost.
   */
  private drawStatusBar(): void {
    const kid = this.scene.chtabs.kid;
    if (!kid) return;
    const full = kid.images[FULL_HP_IMAGE];
    const empty = kid.images[EMPTY_HP_IMAGE];
    for (let i = this.hitPoints; i < this.maxHitPoints; i++) {
      if (empty) this.surface.blitOpaque(empty, i * 7, HP_TOP_Y, kid.paletteBase);
    }
    for (let i = 0; i < this.hitPoints; i++) {
      if (full) this.surface.blitOpaque(full, i * 7, HP_TOP_Y, kid.paletteBase);
    }
    // The guard's own hit points count down from the right.
    const guardSet = this.scene.chtabs.guard;
    const marker = guardSet?.images[1];
    if (!marker || this.guard.direction === NO_DIRECTION) return;
    for (let i = this.guard.hitPoints; i < this.guard.maxHitPoints; i++) {
      this.surface.blitMono(marker, 314 - i * 7, HP_TOP_Y, 0);
    }
    for (let i = 0; i < this.guard.hitPoints; i++) {
      this.surface.blitOpaque(marker, 314 - i * 7, HP_TOP_Y, guardSet.paletteBase);
    }
  }
}

/** Sprite ids of the full and empty hit point markers in the Prince's group. */
const FULL_HP_IMAGE = 217;
const EMPTY_HP_IMAGE = 218;
const HP_TOP_Y = 194;

export { ROOM_COLUMNS };
