/**
 * One playable level: the scene it draws from, the Prince, and a frame step.
 */
import type { Assets } from '../render/assets.ts';
import { Surface } from '../render/surface.ts';
import { RoomRenderer, type CharacterDraw } from '../render/room.ts';
import { buildLevelScene, type LevelScene } from './scene.ts';
import { readExeTables, type ExeTables } from './exe-tables.ts';
import { newCharacter, placeCharacter, type CharacterState } from './character.ts';
import { stepKid, enterLevel, type Controls, type KidContext, type TrapHooks } from './kid.ts';
import type { World } from './physics.ts';
import { TILE_TYPE_MASK, ROOM_COLUMNS } from './tiles.ts';
import { Traps, type TrapEffects } from './traps.ts';
import { Prng } from './random.ts';

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
  private readonly renderer: RoomRenderer;
  private readonly ctx: KidContext;

  private constructor(scene: LevelScene, tables: ExeTables, effects: TrapEffects = {}) {
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
      startSpike: (room, tilePos) => this.traps.startSpike(room, tilePos),
      spikeHarm: (room, tilePos) => this.traps.spikeHarm(room, tilePos),
    };
    this.ctx = {
      tables,
      world,
      spriteWidth: (image) => scene.chtabs.kid?.images[image + 1]?.width ?? 0,
      controls: { x: 0, y: 0, shift: false },
      traps: trapHooks,
    };
    enterLevel(
      this.kid, scene.level.startRoom, scene.level.startPos, scene.level.startDir, this.ctx,
    );
    this.drawnRoom = this.kid.room;
    this.traps.drawnRoom = this.drawnRoom;
    this.startRoomTiles(this.drawnRoom);
    this.renderer = new RoomRenderer(scene.chtabs, scene.tiles, scene.options);
  }

  static async start(
    assets: Assets, exe: Uint8Array, levelNumber: number, options: GameOptions = {},
  ): Promise<Game> {
    const scene = await buildLevelScene(assets, exe, levelNumber, options.prefix ?? 'V');
    return new Game(scene, readExeTables(exe), options.effects);
  }

  /**
   * Advance one frame of the game: first the room reacts, then the Prince
   * moves, which is the order the original uses.
   */
  step(controls: Controls): void {
    this.traps.drawnRoom = this.drawnRoom;
    this.traps.kidRoom = this.kid.room;
    this.traps.kidRow = this.kid.currentRow;
    this.traps.kidAlive = this.kid.alive;
    this.traps.step();
    stepKid(this.kid, controls, this.ctx);
    if (this.kid.room !== 0) this.drawnRoom = this.kid.room;
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
    const draw = this.kidDraw();
    this.renderer.render(this.surface, this.drawnRoom, draw ? [draw] : []);
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
  }
}

/** Sprite ids of the full and empty hit point markers in the Prince's group. */
const FULL_HP_IMAGE = 217;
const EMPTY_HP_IMAGE = 218;
const HP_TOP_Y = 194;

export { ROOM_COLUMNS };
