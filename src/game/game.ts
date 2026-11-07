/**
 * One playable level: the scene it draws from, the Prince, and a frame step.
 */
import type { Assets } from '../render/assets.ts';
import { Surface } from '../render/surface.ts';
import { readFont, drawTextCentred, type Font } from '../render/font.ts';
import { RoomRenderer, type CharacterDraw, type MobDraw } from '../render/room.ts';
import { buildLevelScene, type LevelScene } from './scene.ts';
import { readExeTables, type ExeTables } from './exe-tables.ts';
import {
  newCharacter, placeCharacter, placeSword, type CharacterState,
} from './character.ts';
import { stepKid, enterLevel, type Controls, type KidContext, type TrapHooks } from './kid.ts';
import { getTile, type World } from './physics.ts';
import { ControlLatch } from './control-latch.ts';
import { TILE, TILE_TYPE_MASK, ROOM_COLUMNS, tileIsFloor } from './tiles.ts';
import { toScreenX, standX, standY } from './geometry.ts';
import { Traps, type TrapEffects } from './traps.ts';
import { Prng } from './random.ts';
import { SWORD_SEQ, SWORD_DRAWN, checkHurting, PARRY_FRAME } from './sword.ts';

/**
 * How near the side of his room a guard has to be to come through it
 * after the Prince. The original's own two numbers, from `exit_room`.
 */
const GUARD_FOLLOWS_LEFT = 91;
const GUARD_FOLLOWS_RIGHT = 165;
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
  /**
   * Frames left of the blank the original shows while it changes room.
   * Three of the four capture sets have two or three solid black frames in
   * them at exactly the moment the view moves; the port used to draw the
   * new room straight away, which is why those captures were recorded as
   * unreproduced.
   */
  private pendingFirstTick = true;
  private blankFrames = 0;
  /** Ticks since the Prince died, for the prompt that follows. */
  private deadTicks = 0;
  /**
   * The green flask: the original lets the next fall pass without hurting
   * him, and the byte-code's `jumpIfFeather` reads it. Nothing has been
   * measured about how long it lasts, so it is set and read and no more.
   */
  featherFall = false;
  /** The tile whose sword or flask the Prince is reaching for. */
  private itemTile: { room: number; column: number; row: number } | null = null;
  /** True once the Prince has walked out of the level. */
  levelFinished = false;
  /** Ticks since the level was built, for the words under the room. */
  private titleTicks = 0;
  /**
   * Ticks of the hour the Prince has to reach the Princess. The original
   * gives him sixty minutes and says how many are left every time a level
   * starts; it runs on across a death, which is the whole point of it.
   */
  remainingTicks = MINUTE_TICKS * 60;
  /** The game's own font, out of the executable. */
  font?: Font;
  /** Ticks left before the level starts again; -1 when none is coming. */
  private restartCountdown = -1;
  hitPoints: number;
  maxHitPoints: number;
  /**
   * Has the Prince got a sword? It lies on the floor of level 1 and he
   * carries it from then on, so every later level starts with it -- which
   * is also the right answer for a level picked straight off the menu.
   */
  hasSword: boolean;
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
    this.hasSword = levelNumber > 1;

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
      impaleOnSpikes: (room, tilePos) => this.traps.impaleOnSpikes(room, tilePos),
      spikeHarm: (room, tilePos) => this.traps.spikeHarm(room, tilePos),
    };
    this.ctx = {
      tables,
      world,
      spriteWidth: (image) => scene.chtabs.kid?.images[image + 1]?.width ?? 0,
      spriteHeight: (image) => scene.chtabs.kid?.images[image + 1]?.height ?? 0,
      controls: { x: 0, y: 0, shift: false },
      traps: trapHooks,
      latch: new ControlLatch(),
      damage: (amount) => this.damage(amount),
      opponent: () => (this.guard.direction === NO_DIRECTION ? null : this.guard),
      hasSword: () => this.hasSword,
      markItem: (room, column, row) => { this.itemTile = { room, column, row }; },
      drawnRoom: () => this.drawnRoom,
      effects: {
        sound: effects.sound,
        /**
         * A heavy landing shakes the loose floors around it. The
         * sequences raise this themselves -- `knockUp` and `knockDown`
         * are opcodes of the byte-code, on the frames where a foot comes
         * down hard -- and nothing was listening, so a loose floor only
         * ever moved when it was stood on. Jumping down beside one did
         * nothing at all.
         *
         * The sign says which row is shaken: the one the character is
         * in, or the one above for a knock that goes upwards.
         */
        knock: (direction) => {
          const row = this.kid.currentRow - (direction > 0 ? 1 : 0);
          if (row < 0 || row > 2) return;
          this.traps.knock(this.kid.room, row);
        },
        // `getItem 1` is whatever is under his feet being taken: the
        // sword lifted off the floor, or a potion drunk. Both animations
        // raise it, and the tile becomes plain floor behind him. It used
        // to assume the sword, so every potion in the game did nothing.
        // The byte-code of sequence 70 raises this as the Prince walks
        // out of the level door.
        endLevel: () => { this.levelFinished = true; },
        getItem: (which) => {
          if (which !== 1) return;
          const at = this.itemTile;
          this.itemTile = null;
          if (!at) return;
          const k = { room: at.room, currentColumn: at.column, currentRow: at.row };
          const tile = this.scene.state.typeAt(k.room, k.currentColumn, k.currentRow);
          if (tile === TILE_SWORD) this.hasSword = true;
          else if (tile === TILE_POTION) {
            this.drink(this.scene.state.modifierAt(k.room, k.currentColumn, k.currentRow) >> 3);
          } else return;
          this.scene.state.setType(k.room, k.currentColumn, k.currentRow, TILE_FLOOR);
          this.scene.state.setModifier(k.room, k.currentColumn, k.currentRow, 0);
        },
      },
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
    const game = new Game(scene, readExeTables(exe), levelNumber, options.effects);
    game.font = readFont(exe);
    return game;
  }

  /**
   * Advance one frame of the game: first the room reacts, then the Prince
   * moves, which is the order the original uses.
   */
  step(controls: Controls): void {
    // The first tick of a level shows what the level start put on the
    // screen, and nothing moves on it. `enterLevel` has already played
    // the first frame of the way in -- frame 102 of the drop on level 1
    // -- and the original holds it for a tick before the game begins.
    //
    // Measured: on every capture of a recorded run, the original's tick
    // n is the port's tick n-1 for the whole of the first room, exactly,
    // with nothing between them. The port was starting a frame in.
    if (this.pendingFirstTick) {
      this.pendingFirstTick = false;
      return;
    }
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
      kidArmed: this.hasSword,
      random: () => this.prng.next(8),
      // `get_tile_infrontof_char` and `get_tile_infrontof2_char`, which
      // follow the room links: a guard who has come through a door is
      // standing a tile or two outside the room he is walking into, and
      // asking his own room for column eleven answers nothing.
      floorInFront: (guard) => {
        const ahead = guard.direction < 0 ? -1 : 1;
        for (const step of [1, 2]) {
          const t = getTile(
            this.ctx.world, guard.room,
            guard.currentColumn + ahead * step, guard.currentRow,
          );
          if (t.room !== 0 && tileIsFloor(t.type)) return true;
        }
        return false;
      },
    });
    this.resolveSwordplay();
    if (this.isDead) this.deadTicks += 1;
    this.titleTicks += 1;
    if (this.remainingTicks > 0) this.remainingTicks -= 1;
    // Any key answers `Press Button to Continue`, not Shift alone, and the
    // game asks whether one is down rather than waiting for a fresh press.
    // The capture shows it: the Prince is impaled on the spikes of level
    // 1's room 6 at tick 284, the words come up at 298, and the screen goes
    // black on 299 -- too quick for anything but the Left the player was
    // already holding down.
    if (this.awaitingButton
      && (controls.x !== 0 || controls.y !== 0 || controls.shift)) {
      this.pressButton();
    }
    // Down to -1, not to 0: `restartDue` is then true for exactly the one
    // tick the level is to be built on.
    if (this.restartCountdown >= 0) this.restartCountdown -= 1;
    if (this.kid.room !== 0) this.drawnRoom = this.kid.room;
    if (this.drawnRoom !== wasDrawing) {
      this.enterRoom(this.drawnRoom);
      this.blankFrames = ROOM_CHANGE_BLANK;
    } else if (this.blankFrames > 0) {
      this.blankFrames -= 1;
    }
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
    // The original's `check_sword_hurting`: each blade is asked what it
    // did this tick, both before either answer is acted on, and then
    // `check_sword_hurt` deals with the guard first.
    const atGuard = checkHurting(this.kid, this.guard);
    const atKid = checkHurting(this.guard, this.kid);
    if (atGuard === 'parried') this.parried(this.kid, this.guard);
    if (atKid === 'parried') this.parried(this.guard, this.kid);
    if (atGuard === 'hurt') this.hurtBySword(this.guard);
    else if (atKid === 'hurt') this.hurtBySword(this.kid);
  }

  /** A blade stopped by a raised one: the striker recoils. */
  private parried(striker: CharacterState, blocker: CharacterState): void {
    blocker.frame = PARRY_FRAME;
    startSequence(striker, SWORD_SEQ.parried, this.tables);
  }

  /**
   * The original's `hurt_by_sword`. A character caught without his blade
   * up dies of it whatever his hit points are; one with it up loses one,
   * and the last of them kills him.
   */
  private hurtBySword(hit: CharacterState): void {
    if (hit.alive >= 0) return;
    // He comes down on the floor of the row he was in, whatever he was
    // doing: the original's `hurt_by_sword` ends `Char.y = y_land[...];
    // Char.fall_y = 0`, so a Prince run through in mid-jump does not
    // hang in the air where the blade caught him.
    hit.y = standY(hit.currentRow);
    hit.fallY = 0;
    hit.fallX = 0;
    if (hit === this.kid) {
      const dead = this.hasSword ? this.damage(1) : this.damage(this.hitPoints);
      startSequence(hit, dead ? SWORD_SEQ.kidDie : SWORD_SEQ.stabbed, this.tables);
      if (dead) hit.alive = 0;
      return;
    }
    this.guard.hitPoints = Math.max(0, this.guard.hitPoints - 1);
    const dead = this.guard.hitPoints === 0;
    startSequence(hit, dead ? SWORD_SEQ.dropDead : SWORD_SEQ.stabbed, this.tables);
    if (dead) hit.alive = 0;
  }


  /**
   * What a flask does, by the kind it is -- the top five bits of its
   * modifier.
   *
   * Level 1 has four of the small red ones and nothing else; level 2 adds
   * the green. The two the port cannot do anything useful with are the
   * ones that turn the picture upside down and the one that opens the way
   * on level 13, and both are left alone rather than half done.
   */
  drink(kind: number): void {
    switch (kind) {
      case 1: // a small red one: one hit point back
        if (this.hitPoints < this.maxHitPoints) this.hitPoints += 1;
        break;
      case 2: // a big red one: one more hit point for good, and a full cup
        this.maxHitPoints += 1;
        this.hitPoints = this.maxHitPoints;
        break;
      case 3: // the green one: the next fall does not hurt
        this.featherFall = true;
        break;
      case 5: // the poison: one hit point, and it can be the last
        this.damage(1);
        if (this.hitPoints === 0) this.kid.alive = 0;
        break;
      default:
        break;
    }
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
   * True once the original would be showing `Press Button to Continue`.
   *
   * It does not come up with the death: a grabbed video of the original
   * has the Prince struck down at tick 177 and the words appear at 221,
   * forty-five ticks later. Until they are up nothing restarts the level,
   * which is why the player in that recording pressed four directions
   * over the next ten seconds and nothing happened.
   */
  get awaitingButton(): boolean {
    return this.isDead && this.deadTicks >= RESTART_PROMPT_DELAY
      && this.restartCountdown < 0;
  }

  /**
   * The button was pressed under `Press Button to Continue`. The level
   * does not come back at once: the original takes six ticks over it, the
   * room still on screen for three and then black for two. Measured off
   * the grabbed video -- Shift at tick 297, black at 301 and 302, the
   * level running again at 303.
   */
  pressButton(): void {
    if (!this.awaitingButton) return;
    this.restartCountdown = RESTART_DELAY;
  }

  /** True on the tick the level should be built again. */
  get restartDue(): boolean {
    return this.restartCountdown === 0;
  }

  /**
   * Put the level back as it was and the Prince back at its start, which is
   * what the original does after a death.
   */
  async restart(assets: Assets, exe: Uint8Array): Promise<Game> {
    const game = await Game.start(assets, exe, this.levelNumber, { effects: this.effects });
    // The hour does not start again with the level.
    game.remainingTicks = this.remainingTicks;
    return game;
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
    if (!this.guardFollows(room)) {
      leaveGuard(this.guard, this.guards);
      enterGuard(this.guard, room, this.guards, {
        tables: this.tables,
        guardType: this.scene.guardType,
        levelGuardHitPoints: this.scene.constants.guardHitPoints[this.levelNumber] ?? 0,
      });
      this.applyGuardColour();
    }
    this.traps.drawnRoom = room;
    this.startRoomTiles(room);
  }

  /**
   * A guard with his sword out comes after the Prince through the door.
   *
   * Every room keeps its own guard, and until now changing room always
   * put that room's guard on the screen and the old one back in his box.
   * So the Prince could walk out of a fight and the guard would stand
   * where he was left, which is not what the original does and is what
   * the player meant by `at that distance he should follow me to the
   * next screen`.
   *
   * This is `exit_room` and `follow_guard` of the original, which
   * SDLPoP has as C. He follows sideways only -- the up and down cases
   * there always fall through to leaving him behind -- and only if the
   * room the Prince is going to has no guard of its own, and only if he
   * is near the door: `Guard.x < 91` going left, `>= 165` going right.
   * Then he is shifted by the width of a room exactly the way the
   * Prince is, and his box in both rooms is emptied.
   *
   * The distance test is the whole of it, and the port had it missing.
   * Shifting a guard who is ten tiles from the door puts him three
   * tiles beyond the far side of the room he is going to; x is one byte,
   * it wraps, and he turns up at the opposite end. The player's
   * recording `33e8ace7` has that: the guard of room 3 was at column 6,
   * arrived in room 2 at column 19, then at -2, walked the wrong way
   * along the bottom of the room and killed the Prince from three tiles
   * off.
   *
   * With the test in place he can still land outside the room -- at
   * x 90 going left he arrives at 230, two tiles past the right edge --
   * and that is right. A grabbed video of the original replaying
   * `e209b01a` has the guard vanish with the room change and walk back
   * into view from the right twenty-four ticks later. His x when the
   * Prince left was 90 or 91, measured from the width of his tunic on
   * the screen, which is the threshold to the unit.
   */
  private guardFollows(room: number): boolean {
    const guard = this.guard;
    if (guard.direction === NO_DIRECTION) return false;
    if (guard.alive >= 0 || guard.sword !== SWORD_DRAWN) return false;
    if (room === guard.room || room === 0) return false;
    const toTheLeft = this.scene.state.linkOf(guard.room, 0) === room;
    const toTheRight = this.scene.state.linkOf(guard.room, 1) === room;
    if (!toTheLeft && !toTheRight) return false;
    // A room with a guard of its own keeps him; a dead one does not count.
    if ((this.guards.tile[room - 1] ?? 0xff) < 30
      && this.guards.seqHi[room - 1] === 0) {
      return false;
    }
    if (toTheLeft ? guard.x >= GUARD_FOLLOWS_LEFT : guard.x < GUARD_FOLLOWS_RIGHT) {
      return false;
    }
    this.guards.tile[guard.room - 1] = 0xff;
    this.guards.tile[room - 1] = 0xff;
    guard.room = room;
    guard.x = (guard.x + (toTheLeft ? 140 : -140)) & 0xff;
    guard.currentColumn += toTheLeft ? 10 : -10;
    return true;
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
    // While the view is changing room the original shows no room -- but it
    // keeps the hit points below it. The captures of those frames are black
    // everywhere except the bottom few rows.
    if (this.blankFrames > 0 || (this.restartCountdown >= 0 && this.restartCountdown <= 1)) {
      this.drawStatusBar();
      return this.surface;
    }
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

    const mobs: MobDraw[] = this.traps.mobs.map((m) => ({
      room: m.room, column: m.xh >> 2, y: m.y, row: m.row,
    }));
    this.renderer.render(this.surface, this.drawnRoom, characters, mobs);
    this.drawStatusBar();
    return this.surface;
  }

  /**
   * The strip below the room. The original draws the Prince's hit points
   * there as small sprites from his own group: a full one for each point he
   * has, an empty one for each he has lost.
   */
  private drawStatusBar(): void {
    this.drawBottomText();
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

  /**
   * Forget the level's number, as the original does once it has been up
   * its forty-nine ticks.
   *
   * Every capture the tests match against was taken after a wait long
   * enough for that -- `tools/oracle/scripts/level-starts.txt` waits eight
   * seconds before the first frame -- so a harness that builds a level and
   * starts stepping has to do the same, or every frame differs by the
   * hundred and twenty-five pixels of `LEVEL n`.
   */
  clearBottomText(): void {
    this.titleTicks = LEVEL_TITLE_TICKS * 2 + 2;
  }

  /**
   * What a level says about itself when it starts: its number for
   * twenty-four ticks, nothing for one, and then how much of the hour is
   * left for twenty-four more.
   *
   * Measured off all ten grabbed runs, which agree to the tick: `LEVEL 1`
   * from tick 0 to 23, nothing on 24, `60 MINUTES LEFT` from 25 to 47,
   * and nothing from 48; and the same again from the tick the level is
   * started afresh after a death. The second message is a tick shorter
   * than the first, which looks like an oversight in the original and is
   * what every capture shows.
   */
  private levelText(): string | null {
    if (this.restartCountdown >= 0) return `LEVEL ${this.levelNumber}`;
    // The first tick of a level is not stepped -- see `pendingFirstTick`
    // -- so `titleTicks` is still zero on the level's first picture and
    // counts the ticks drawn before this one.
    const t = this.titleTicks;
    if (t < LEVEL_TITLE_TICKS) return `LEVEL ${this.levelNumber}`;
    if (t === LEVEL_TITLE_TICKS) return null;
    if (t < LEVEL_TITLE_TICKS * 2) {
      const left = Math.max(0, Math.ceil(this.remainingTicks / MINUTE_TICKS));
      return `${left} MINUTE${left === 1 ? '' : 'S'} LEFT`;
    }
    return null;
  }

  /** `Press Button to Continue`, or what the level says about itself. */
  private drawBottomText(): void {
    if (!this.font) return;
    // The words stay up for the tick the button is pressed on; the level's
    // number takes over only once the screen has gone black. The capture
    // has `Press Button to Continue` on 298, black with `LEVEL 1` on 299
    // and 300, and the level running again on 301.
    const blanking = this.restartCountdown >= 0 && this.restartCountdown <= 1;
    const asking = this.isDead && this.deadTicks >= RESTART_PROMPT_DELAY && !blanking;
    const text = asking ? 'Press Button to Continue' : this.levelText();
    if (!text) return;
    drawTextCentred(this.surface, this.font, text, 0, 319, TEXT_TOP_Y, TEXT_WHITE);
  }
}

/**
 * The words under the room.
 *
 * Two of them, and the original draws both in white in the strip below the
 * room: the level's number when it starts, and `Press Button to Continue`
 * once the Prince is dead and the game is waiting to be told to begin
 * again. The port drew neither, because nothing in it could draw a letter
 * -- see src/render/font.ts, which reads the font out of the executable.
 *
 * Both are measured off the grabbed video of the recorded run of level 1:
 * `LEVEL 1` is forty-one pixels wide at x 139 and rows 193 to 199, and
 * `Press Button to Continue` is a hundred and fifty at x 85 on the same
 * rows. Centring each in the three hundred and twenty gives exactly those
 * two numbers, so there is nothing else to pin.
 */
const TEXT_TOP_Y = 193;
const TEXT_WHITE = 15;

/**
 * How long each of the two things a level says about itself stays up.
 * Every capture has `LEVEL 1` from tick 0 to 23, nothing on 24, and
 * `60 MINUTES LEFT` from 25 to 47.
 */
export const LEVEL_TITLE_TICKS = 24;

/** Ticks in a minute of the original's hour: twelve a second, sixty seconds. */
export const MINUTE_TICKS = 720;

/**
 * How many ticks the screen stays blank when the view changes room.
 *
 * One, and the two kinds of evidence disagree about it.
 *
 * A grabbed video of the original says two. The display is grabbed well
 * above the game's twelve ticks a second, so a tick is a run of frames
 * and the black ones can be counted: both room changes of the replayed
 * level 1 recording hold black for four or five grabbed frames, which is
 * two ticks of wall clock, not one.
 *
 * The screenshots say one. tests/game/run.test.ts and run-jump.test.ts
 * match captures of the original pixel for pixel, and the frame each one
 * caught just after a room change is the state one tick after the view
 * moved -- a state a two-tick blank would hide, and which then matches
 * nothing at all.
 *
 * Both can be true: the original clears the screen and redraws it, and
 * the redraw takes longer than a refresh, so the grab sees black for
 * about two ticks while a screenshot -- which saves the finished buffer
 * -- sees the drawn room. That makes the two-tick blank a property of the
 * redraw rather than of the game, and the pixel-exact captures the better
 * evidence for what the game shows. It stays at one until something
 * settles it the other way.
 */
export const ROOM_CHANGE_BLANK = 1;

/**
 * Ticks between the Prince dying and `Press Button to Continue`.
 *
 * The words come up fourteen ticks after the Prince does, measured off
 * the grabbed video of the recorded run: the first blood on the spikes of
 * level 1's room 6 is tick 284 and the words are up on 298. The constant
 * is one more than that because `deadTicks` has already counted the tick
 * the blood appeared on by the time this is asked. An earlier reading of a different capture made it forty-five,
 * from a sword death whose first frame was harder to place; this one is a
 * splash of red on a tick that has nothing else going on.
 */
export const RESTART_PROMPT_DELAY = 15;

/**
 * Ticks from the button being pressed to the level running again. Three,
 * of which the middle two are black: the words up on tick 298 of the
 * grabbed video with Left already held, black on 299 and 300, the level
 * running again on 301. The words are on screen for the tick the button
 * is pressed on, which is why this is three and not two.
 */
export const RESTART_DELAY = 3;

const TILE_SWORD = TILE.sword;
const TILE_POTION = TILE.potion;
const TILE_FLOOR = TILE.floor;

/** Sprite ids of the full and empty hit point markers in the Prince's group. */
const FULL_HP_IMAGE = 217;
const EMPTY_HP_IMAGE = 218;
const HP_TOP_Y = 194;

export { ROOM_COLUMNS };
