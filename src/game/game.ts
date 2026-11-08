/**
 * One playable level: the scene it draws from, the Prince, and a frame step.
 */
import type { Assets } from '../render/assets.ts';
import { Surface } from '../render/surface.ts';
import { readFont, drawTextCentred, type Font } from '../render/font.ts';
import {
  RoomRenderer, type CharacterDraw, type CharacterOverlay, type MobDraw,
} from '../render/room.ts';
import { buildLevelScene, type LevelScene } from './scene.ts';
import { readExeTables, type ExeTables, type Frame } from './exe-tables.ts';

/** `y_clip`: the top row of each of the room's rows, and of the one below. */
const Y_CLIP = [-60, 3, 66, 129, 192];
import {
  newCharacter, placeCharacter, placeHurtSplash, placeSword, type CharacterState,
} from './character.ts';
import {
  stepKid, exitRoom, enterLevel, objectX,
  type Controls, type KidContext, type TrapHooks,
} from './kid.ts';
import {
  getTile, tileDivMod, tileDivModM7, charCollision, type World,
} from './physics.ts';
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
/**
 * The noises that set `is_guard_notice`.
 *
 * The byte-code's `sound` opcode raises nought for a footfall that is
 * heard but not played and one for a footstep, and `play_seq` sets the
 * flag on both; `bumped_sound` sets it on walking into a wall, and
 * `land` sets it on a soft and on a medium landing. Those are the
 * five, as the sounds the port's `SEQUENCE_SOUND` and `traps` give
 * them: silence, 23, 8, 17 and 16.
 */
const HEARD_BY_GUARDS = new Set([SOUND_SILENCE, 23, 8, 17, 16]);

const GUARD_FOLLOWS_LEFT = 91;
const GUARD_FOLLOWS_RIGHT = 165;
import { startSequence, playSequence, ACTION, SOUND_SILENCE } from './sequence.ts';
import {
  newGuard, guardsFromLevel, positionGuards, enterGuard, leaveGuard, guardDraw,
  guardFrame, stepGuard, refractoryFor, NO_DIRECTION, canGuardSeeKid, type GuardState,
  type GuardsData,
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

  /**
   * `justblocked`: four ticks after a blow of the guard's own has been
   * parried. While it is running he blocks on the harder of the two
   * tables -- see `guardBlock`.
   */
  private justBlocked = 0;
  hitPoints: number;
  /**
   * `hitp_delta < 0` and `guardhp_delta < 0`: hit points came off this
   * tick, so the splash is drawn over whoever lost them.
   */
  private kidHurt = false;
  private guardHurt = false;

  /**
   * `exit_room_timer`: how many more ticks nobody may change room in.
   *
   * The last line of `redraw_screen` is `exit_room_timer = 2`, and the
   * first lines of `exit_room` are to decrement it and return while it
   * is not nought. So the two ticks after the screen has been drawn
   * whole -- a room change, or the start of a level -- are ticks in
   * which the Prince cannot step out of the room he is in and a guard
   * cannot follow him out of it. Everything else about those ticks
   * happens as usual: both are played, the swordplay is settled, only
   * the doorway is shut.
   *
   * The port had a guess in place of this: a guard who had just
   * followed stood still for two ticks. That was measured, on
   * `probeF`, and it was right about those two ticks for the wrong
   * reason -- it froze the guard instead of shutting the door, and so
   * it was wrong wherever a room change was not involved. With the
   * freeze `0fbffa60` has the guard of room 2 come on two ticks late
   * for the whole of his approach; without it `probeF` has him two
   * ticks early.
   */
  private exitRoomTimer = 2;

  /**
   * `knock`, which the byte-code raises and `check_knock` acts on.
   *
   * The original does not shake anything on the spot: the opcode sets a
   * flag and `check_knock()` -- the last line of `play_kid_frame`, after
   * the fall, the landing and everything else -- reads it and shakes the
   * row the character has *ended up* in. The port shook on the spot,
   * from inside the sequence, when the row was still the one he had
   * jumped from.
   */
  private pendingKnock = 0;

  /** `is_guard_notice`; see the `sound` effect. */
  private guardNotice = false;

  /**
   * `get_tile_at_kid`: the tile of the Prince's own room and row at an
   * x, for the line of sight between a guard and him.
   */
  private readonly tileAtKid = (xpos: number): { type: number; modifier: number } => {
    const t = getTile(
      this.ctx.world, this.kid.room,
      tileDivModM7(xpos).column, this.kid.currentRow,
    );
    return {
      type: t.type,
      modifier: t.room ? this.scene.state.modifierAt(t.room, t.column, t.row) : 0,
    };
  };
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
  /**
   * The same world and traps as the Prince's, with the guard's own
   * sprites and his own hit points: what `play_guard_frame` hands to
   * `check_action` and the four checks after it.
   */
  private readonly guardCtx: KidContext;

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
      startRoom: scene.level.startRoom,
      effects: {
        /**
         * `is_guard_notice`: a noise tells a guard the Prince is there.
         * The byte-code's `sound` opcode raises nought for a footfall
         * that is heard but not played and one for a footstep, and
         * both of those set it in `play_seq`; so do a hard landing and
         * walking into a wall, which come through here as the same
         * two codes. It is the only thing that makes a guard with his
         * back turned look round.
         */
        sound: (which) => {
          if (HEARD_BY_GUARDS.has(which)) this.guardNotice = true;
          effects.sound?.(which);
        },
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
        knock: (direction) => { this.pendingKnock = direction; },
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
    this.guardCtx = {
      ...this.ctx,
      spriteWidth: (image) => scene.chtabs.guard?.images[image + 1]?.width ?? 0,
      spriteHeight: (image) => scene.chtabs.guard?.images[image + 1]?.height ?? 0,
      // A guard who falls into the spikes loses his own hit points, not
      // the Prince's, and the hundred `spiked` and `chomped` take is all
      // of them however many he had.
      damage: (amount) => {
        if (this.guard.hitPoints > 0) this.guardHurt = true;
        this.guard.hitPoints = Math.max(0, this.guard.hitPoints - amount);
        return this.guard.hitPoints === 0;
      },
      opponent: () => this.kid,
      // Nothing a guard walks over is picked up, and he has no keyboard.
      markItem: undefined,
      hasSword: () => true,
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
    // `hitp_delta = 0; guardhp_delta = 0;` at the top of the original's
    // main loop, just before `play_frame`. Whatever takes hit points off
    // during the tick sets it, and the drawing reads it: that is the
    // only thing that puts the hurt splash on the screen.
    this.kidHurt = false;
    this.guardHurt = false;
    const wasDrawing = this.drawnRoom;
    this.traps.drawnRoom = this.drawnRoom;
    this.traps.kidRoom = this.kid.room;
    this.traps.kidRow = this.kid.currentRow;
    this.traps.kidAlive = this.kid.alive;
    this.traps.step();
    // `check_can_guard_see_kid()` sits on the line above
    // `play_kid_frame()` in the original's `play_frame`, so the sight a
    // guard acts on this tick is the Prince as he was at the end of the
    // last one.
    const canGuardSee = canGuardSeeKid(this.guard, this.kid, {
      tables: this.tables, tileAtKid: this.tileAtKid,
    });
    stepKid(this.kid, controls, this.ctx);
    // `check_knock()`, the last line of `play_kid_frame`.
    if (this.pendingKnock !== 0) {
      const row = this.kid.currentRow - (this.pendingKnock > 0 ? 1 : 0);
      this.pendingKnock = 0;
      if (row >= 0 && row <= 2) this.traps.knock(this.kid.room, row);
    }
    stepGuard(this.guard, {
      tables: this.tables,
      effects: this.effects,
      drawnRoom: this.drawnRoom,
      kidRoom: this.kid.room,
      kidRow: this.kid.currentRow,
      kidX: this.kid.x,
      kid: this.kid,
      kidArmed: this.hasSword,
      // The world and the traps, so a guard falls off a ledge, stands
      // on a plate, dies on spikes and is cut in half by a chomper --
      // all of which `play_guard_frame` runs and the port did not.
      physics: this.guardCtx,
      // `prandom(255)`. It was `next(8)`, which is not the same roll at
      // all: every one of the original's probabilities is a number out
      // of 255, so against a nought-to-eight roll anything over eight
      // always wins. A guard of level 1 strikes on 61 and advances on
      // 255, so he struck every tick he could and never missed a chance
      // to close -- which is why he killed a Prince who stood still in
      // a dozen ticks and the capture's did not.
      random: () => this.prng.next(255),
      justBlocked: () => this.justBlocked !== 0,
      heard: () => this.guardNotice,
      forget: () => { this.guardNotice = false; },
      // `get_tile_infrontof_char` and `get_tile_infrontof2_char`, which
      // follow the room links: a guard who has come through a door is
      // standing a tile or two outside the room he is walking into, and
      // asking his own room for column eleven answers nothing.
      // `get_tile_at_kid`: the tile of the Prince's own room and row at
      // an x, for the line of sight between a guard and him.
      tileAtKid: this.tileAtKid,
      canGuardSee,
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
    // `exit_room()`, after the guard's frame and after the hit points:
    // see `exitRoomTimer`.
    if (this.exitRoomTimer !== 0) {
      this.exitRoomTimer -= 1;
    } else if (this.kid.room !== 0) {
      exitRoom(this.kid, this.ctx);
    }
    // `check_the_end()`, which takes the screen to the room the Prince
    // has just stepped into, and `redraw_screen`, which shuts the
    // doorway for the two ticks after it.
    if (this.kid.room !== 0) this.drawnRoom = this.kid.room;
    if (this.drawnRoom !== wasDrawing) {
      this.enterRoom(this.drawnRoom);
      this.blankFrames = ROOM_CHANGE_BLANK;
      this.exitRoomTimer = 2;
    } else if (this.blankFrames > 0) {
      this.blankFrames -= 1;
    }
    if (this.isDead) this.deadTicks += 1;
    if (this.justBlocked > 0) this.justBlocked -= 1;
    this.titleTicks += 1;
    if (this.remainingTicks > 0) this.remainingTicks -= 1;
    // Shift answers `Press Button to Continue`, and nothing else does:
    // `if (rem_min != 0 && Kid.alive > 6 && (control_shift || key ==
    // RETURN))` in seg000. The port took any key, which is wrong and is
    // not a small wrongness -- the player is usually leaning on a
    // direction when he dies, so the port restarted the level the
    // instant the words were due and the rest of the run was a
    // different run.
    //
    // Six captures say the same thing. In `25c4ebb8` the words come up
    // on tick 278 with Left held and are still there at the end of the
    // recording, a hundred and twenty ticks later, because the player
    // never pressed Shift. In the five that do restart -- `756b259c`,
    // `5920a8c2`, `72b3522f`, `9b60bf3a`, `848ee3c4` -- the words go
    // within a few ticks of the first tick Shift is down, and not before.
    if (this.acceptsButton && controls.shift) {
      this.pressButton();
    }
    // Down to -1, not to 0: `restartDue` is then true for exactly the one
    // tick the level is to be built on.
    if (this.restartCountdown >= 0) this.restartCountdown -= 1;
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
    // `if (Char.charid != charid_0_kid) justblocked = 4;` -- only the
    // guard's own blow being stopped counts.
    if (striker === this.guard) this.justBlocked = 4;
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
      // `hurt_by_sword` ends with `play_seq()`: the first frame of being
      // run through is drawn in the tick the blade lands, not the tick
      // after. The port left it for the next one, so the whole of the
      // death came a tick late -- six ticks of `probeF`.
      playSequence(hit, { tables: this.tables, effects: this.effects });
      return;
    }
    if (this.guard.hitPoints > 0) this.guardHurt = true;
    this.guard.hitPoints = Math.max(0, this.guard.hitPoints - 1);
    const dead = this.guard.hitPoints === 0;
    startSequence(hit, dead ? SWORD_SEQ.dropDead : SWORD_SEQ.stabbed, this.tables);
    if (dead) hit.alive = 0;
    playSequence(hit, { tables: this.tables, effects: this.effects });
    // `check_sword_hurt`: a guard who has been hit holds off for a while,
    // the while being his skill's own number. The port had the timer and
    // the table and never set it, so a guard came straight back at the
    // Prince on the tick after taking a blow and there was no moment to
    // press the attack in.
    this.guard.waitTimer = refractoryFor(this.guard.skill);
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
    // `take_hp`: the delta is what he actually loses, so a hit on a
    // Prince who has nothing left to lose sets nothing and draws no
    // splash.
    if (amount > 0 && this.hitPoints > 0) this.kidHurt = true;
    this.hitPoints = Math.max(0, this.hitPoints - amount);
    return this.hitPoints === 0;
  }

  /** True once the Prince is dead and the level is waiting to be restarted. */
  get isDead(): boolean {
    return this.hitPoints === 0 || this.kid.alive >= 0;
  }

  /**
   * True once the original would be showing `Press Button to Continue`.
   * Forty-six ticks after the death: see `RESTART_PROMPT_DELAY`.
   */
  get awaitingButton(): boolean {
    return this.isDead && this.deadTicks >= RESTART_PROMPT_DELAY
      && this.restartCountdown < 0;
  }

  /**
   * True once Shift will start the level again, which is seven ticks
   * after the death and not the forty-six the words take: the original's
   * test is `Kid.alive > 6`, and `Char.alive` is nought on the tick he
   * dies. The two are different things and the port had only one of
   * them, so a player who pressed Shift while the body was still
   * settling was ignored until the words came up.
   *
   * Measured on `b4ff4672`: the Prince goes onto the spikes of room 6 on
   * tick 282, Shift goes down on 297, and the capture has the level's
   * title back on the screen by 304 -- twenty-five ticks before the
   * words would have appeared at all.
   */
  get acceptsButton(): boolean {
    return this.isDead && this.deadTicks > RESTART_BUTTON_DELAY
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
    if (!this.acceptsButton) return;
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
    // And nothing to his column. `goto_other_room` moves x and, for up
    // and down, y and the row; it leaves `curr_col` alone, and
    // `load_fram_det_col` reads it off the new x at the top of the
    // guard's next frame.
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
    // `anim_tile_modif`: all thirty tiles of the room first, and the
    // right-hand column of the room to its left after them, not
    // interleaved row by row. The order is the order the rolls come
    // out of the generator in, and every roll after a wrong one is a
    // different roll.
    for (let tilePos = 0; tilePos < 30; tilePos++) {
      const type = this.scene.state.typeAt(room, tilePos % 10, Math.trunc(tilePos / 10));
      if (type === 19 || type === 30) {
        this.startAnimTorch(room, tilePos);
      } else if (type === 10) {
        // `start_anim_potion`: the bubbles start at a random point in
        // their seven-frame cycle, and the top five bits of the
        // modifier -- which say what is in the flask -- are kept.
        //
        // The port left the modifier alone, so every potion in the
        // game bubbled in step from frame nought. It is not masked out
        // of the comparison the way a flame is, and in `0fbffa60` the
        // flask of room 5 comes into view on tick 433 and is wrong in
        // every one of the 291 ticks after it.
        const was = this.scene.state.modifierAt(room, tilePos % 10, Math.trunc(tilePos / 10));
        this.scene.state.setModifierAtPos(
          room, tilePos, (was & 0xf8) | (this.prng.next(6) + 1),
        );
        this.traps.add(room, tilePos, 1);
      } else if (type === 22) {
        // `start_anim_sword`.
        this.scene.state.setModifierAtPos(room, tilePos, this.prng.next(0xff) & 0x1f);
        this.traps.add(room, tilePos, 1);
      }
    }
    const left = this.scene.state.linkOf(room, 0);
    if (left) {
      for (let row = 0; row < 3; row++) {
        const type = this.scene.state.typeAt(left, 9, row);
        if (type === 19 || type === 30) this.startAnimTorch(left, row * 10 + 9);
      }
    }
  }

  /** `start_anim_torch`: `prandom(8)`, not `prandom(255)`. */
  private startAnimTorch(room: number, tilePos: number): void {
    this.scene.state.setModifierAtPos(room, tilePos, this.prng.next(8));
    this.traps.add(room, tilePos, 1);
  }

  /** What to draw for the Prince, if he is in the room being shown. */
  kidDraw(): CharacterDraw | null {
    if (this.kid.room !== this.drawnRoom) return null;
    const frame = this.tables.frameTableKid[this.kid.frame];
    if (!frame) return null;
    const draw = placeCharacter(this.kid, frame);
    if (!draw) return null;
    const overlay = this.overlayOf(this.kid, frame, 'kid');
    const clipTop = this.clipTopOf(this.kid, frame, 'kid');
    const tile = this.objTileOf(this.kid, frame, 'kid');
    return {
      ...draw, objColumn: tile.column, objRow: tile.row,
      ...(overlay ? { overlay } : {}), ...(clipTop ? { clipTop } : {}),
    };
  }

  /**
   * `set_objtile_at_char`: which tile a character's object sits at.
   *
   * A running jump takes the tile under the leading foot; anything
   * else the tile he is standing in -- and a character who is
   * climbing, hanging or in the air takes the one to its *left*.
   *
   * It decides where he comes in the painting, because the room is
   * painted row 2, row 1, row 0, each row left to right, with every
   * object slotted in at its own tile. The left step is why a falling
   * Prince goes behind the slab that fell with him and behind the
   * floors of his own column: they are painted after him.
   */
  private objTileOf(
    state: CharacterState, frame: Frame, chtab: 'kid' | 'guard',
  ): { column: number; row: number } {
    const f = state.frame;
    const a = state.action;
    let row = state.currentRow;
    let column = state.currentColumn;
    if (a === ACTION.runJump) {
      const set = chtab === 'kid' ? this.scene.chtabs.kid : this.scene.chtabs.guard;
      const image = set?.images[frame.image + 1];
      if (image) {
        const coll = charCollision(state, frame, objectX(state, frame), image.width);
        const objY = frame.dy + state.y;
        let bottomRow = (Math.trunc((objY + 60) / 63) % 4) - 1;
        if (bottomRow === -1) bottomRow = 3;
        row = bottomRow;
        column = Math.max(tileDivMod(coll.xLeft).column, 0);
      }
    }
    if ((f >= 135 && f < 149) || a === ACTION.hangClimb || a === ACTION.inMidair
      || a === ACTION.inFreefall || a === ACTION.hangStraight) {
      column -= 1;
    }
    return { column, row };
  }

  /**
   * `clip_char`, the part of it that matters: a character with a floor
   * or a wall over his head is not drawn above the row he is in.
   *
   * The original clips him at `y_clip[row + 1]`, the top of his own
   * row, when the tile over his left shoulder is a wall or a floor and
   * the tile over his right is too -- or he is on the two frames of a
   * jump that reach up into it. Without it the arm of a Prince
   * dropping into a room is drawn straight through the floor he has
   * just come through: `ec99dc5b` tick 78, and every fall into a room
   * below.
   *
   * The rest of `clip_char` -- the level door, the doortops and the
   * mirror, all of which clip on the right -- is not here yet.
   */
  private clipTopOf(
    state: CharacterState, frame: Frame, chtab: 'kid' | 'guard',
  ): number {
    const set = chtab === 'kid' ? this.scene.chtabs.kid : this.scene.chtabs.guard;
    const image = set?.images[frame.image + 1];
    if (!image) return 0;
    const coll = charCollision(state, frame, objectX(state, frame), image.width);
    const objY = frame.dy + state.y;
    let topY = objY - image.height + 1;
    if (topY >= 192) topY = 0;
    const rowOf = (y: number): number => (Math.trunc((y + 60) / 63) % 4) - 1;
    const topRow = rowOf(topY);
    const colLeft = Math.max(tileDivMod(coll.xLeft).column, 0);
    const colRight = Math.min(tileDivMod(coll.xRight).column, 9);
    const above = (col: number): number => getTile(
      this.ctx.world, state.room, col, topRow,
    ).type;
    const blocks = (t: number): boolean => t === TILE.wall || tileIsFloor(t);
    if (!blocks(above(colLeft))) return 0;
    const jumping = state.action === ACTION.stand
      && (state.frame === 79 || state.frame === 81);
    if (!jumping && !blocks(above(colRight))) return 0;
    const clipRow = state.currentRow + 1;
    const clipY = Y_CLIP[clipRow];
    if (clipY === undefined) return 0;
    if (clipRow === 1 || (clipY < objY && clipY - 15 < topY)) return clipY;
    return 0;
  }

  /**
   * `redraw_at_char2`: which tiles are drawn again over this character.
   *
   * A character who is in the air, hanging, grabbing or climbing marks
   * the tiles his box covers, and `redraw_needed` draws those tiles
   * into the mid table -- where the ones past his own come down over
   * him. Climbing, frames 137 to 144, it is the floor's lip instead of
   * the whole tile. Anything else marks nothing.
   */
  private overlayOf(
    state: CharacterState, frame: Frame, chtab: 'kid' | 'guard',
  ): CharacterOverlay | undefined {
    const f = state.frame;
    const a = state.action;
    let climbFrame: number | undefined;
    // Frames 78 and 79, the grab, always mark; otherwise it is the
    // climb or one of the four actions that leave a character in the
    // air, plus a bump in the middle of a fall.
    if (f < 78 || f >= 80) {
      if (f >= 137 && f < 145) {
        climbFrame = f;
      } else if (a !== ACTION.hangClimb && a !== ACTION.inMidair
        && a !== ACTION.inFreefall && a !== ACTION.hangStraight
        && !(a === ACTION.bumped && f >= 102 && f <= 106)) {
        return undefined;
      }
    }
    const set = chtab === 'kid' ? this.scene.chtabs.kid : this.scene.chtabs.guard;
    const image = set?.images[frame.image + 1];
    if (!image) return undefined;
    const coll = charCollision(state, frame, objectX(state, frame), image.width);
    const objY = frame.dy + state.y;
    let topY = objY - image.height + 1;
    if (topY >= 192) topY = 0;
    const rowOf = (y: number): number => (Math.trunc((y + 60) / 63) % 4) - 1;
    let bottomRow = rowOf(objY);
    if (bottomRow === -1) bottomRow = 3;
    const colLeft = Math.max(tileDivMod(coll.xLeft).column, 0);
    // `set_objtile_at_char`: which tile the character is painted with.
    // A running jump is painted with the tile under his leading foot;
    // anything else with the one he is standing in -- and a character
    // who is climbing, hanging or in the air is painted with the tile
    // one to the *left* of that.
    //
    // That last line is what puts a falling Prince behind the ledge he
    // is dropping past. The room is painted left to right, a character
    // with his own tile, so every tile from his own column on is
    // painted after him and comes down over him. The port had him at
    // his own column, so only the tiles past it covered him, and the
    // first fall of level 1 -- which is in all nineteen recordings --
    // drew him in front of the ledge for the three ticks he is beside
    // it.
    const ownTile = this.objTileOf(state, frame, chtab);
    return {
      colLeft,
      colRight: Math.min(tileDivMod(coll.xRight).column, 9),
      topRow: rowOf(topY),
      bottomRow,
      skipBottomRow: a === ACTION.hangClimb,
      ownColumn: ownTile.column,
      ownRow: ownTile.row,
      climbFrame,
    };
  }

  /**
   * The star at the point of impact, if hit points came off the Prince
   * this tick. `draw_hurt_splash`, called from `draw_kid` when
   * `hitp_delta < 0`.
   */
  hurtSplashDraw(): CharacterDraw | null {
    if (!this.kidHurt) return null;
    const kid = this.kidDraw();
    return kid ? placeHurtSplash(kid, this.kid.frame, 'kid') : null;
  }

  /** The same for the guard, from `draw_guard`. */
  guardHurtSplashDraw(): CharacterDraw | null {
    if (!this.guardHurt) return null;
    if (this.guard.room !== this.drawnRoom || this.guard.direction === NO_DIRECTION) return null;
    const draw = guardDraw(this.guard, this.tables);
    return draw ? placeHurtSplash(draw, this.guard.frame, 'guard') : null;
  }

  /**
   * Draw the tick.
   *
   * `showBlank: false` draws the room the game has even on the ticks the
   * original is holding a black screen over it while it redraws. That is
   * what a screenshot of the original catches -- it saves the finished
   * buffer, not what the monitor is showing -- and it is what the
   * pixel-exact captures in `tests/game/run.test.ts` and
   * `run-jump.test.ts` are of. A video grab of the same moment is black:
   * see `ROOM_CHANGE_BLANK`.
   */
  render(options: { showBlank?: boolean } = {}): Surface {
    const showBlank = options.showBlank ?? true;
    this.surface.clear();
    // While the view is changing room the original shows no room -- but it
    // keeps the hit points below it. Only a slow DOSBox does that, and
    // `ROOM_CHANGE_BLANK` is nought, so this is dead unless it is put
    // back; a level restart does not blank at all.
    if (showBlank && this.blankFrames > 0) {
      this.drawStatusBar();
      return this.surface;
    }
    const characters: CharacterDraw[] = [];

    if (this.guard.room === this.drawnRoom && this.guard.direction !== NO_DIRECTION) {
      const frame = guardFrame(this.guard, this.tables);
      // `add_sword_to_objtable` leaves `obj_tilepos` as
      // `add_guard_to_objtable` set it, so the sword is painted with
      // the hand that holds it.
      const at = frame ? this.objTileOf(this.guard, frame, 'guard') : undefined;
      const tile = at ? { objColumn: at.column, objRow: at.row } : {};
      const draw = guardDraw(this.guard, this.tables);
      if (draw) characters.push({ ...draw, ...tile });
      const guardSplash = this.guardHurtSplashDraw();
      if (guardSplash) characters.push(guardSplash);
      // A living guard always has his sword out.
      if (frame && this.guard.alive < 0) {
        const sword = placeSword(this.guard, frame, this.tables.swordTable, toScreenX);
        if (sword) characters.push({ ...sword, ...tile });
      }
    }

    const kid = this.kidDraw();
    if (kid) characters.push(kid);
    const kidSplash = this.hurtSplashDraw();
    if (kidSplash) characters.push(kidSplash);
    const kidFrame = this.tables.frameTableKid[this.kid.frame];
    if (kid && kidFrame && this.kid.sword !== 0) {
      const sword = placeSword(this.kid, kidFrame, this.tables.swordTable, toScreenX);
      if (sword) {
        characters.push({
          ...sword, objColumn: kid.objColumn, objRow: kid.objRow,
        });
      }
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
 * None. The original does not blank at all.
 *
 * It looked as though it did. At three thousand cycles -- a 286 at about
 * eight megahertz, which is the machine the game was written for --
 * DOSBox cannot redraw a room inside one of the game's ticks, and the
 * grabbed video is black for the two ticks the redraw takes. Every
 * session capture in tests/golden was taken at that speed, and three of
 * the thirteen frames of the run-jump are that blank.
 *
 * At twenty thousand cycles not one frame of any capture is black:
 * neither at a room change nor at a level restart, which is the harder
 * case because the whole level is built again. `probeF` changes room at
 * tick 190 and restarts the level at 431, and the capture goes straight
 * from the one room to the next and from the death screen to the new
 * level, with nothing between. So the blank is the slow machine's, not
 * the game's, and the port -- which redraws in no time -- should have
 * none of it.
 *
 * Measured against the captures at twenty thousand cycles, dropping it
 * takes `probeC` from 228 of its 236 ticks pixel-exact to 230, `probeE`
 * from 155 of 163 to 157, and `probeF` from 741 of 1194 to 745.
 */
export const ROOM_CHANGE_BLANK = 0;

/**
 * Ticks between the Prince dying and `Press Button to Continue`.
 *
 * The original counts: `Char.alive` goes up a tick at a time once he is
 * dead, the death music starts at six, and the words come up at seven
 * once that music has finished -- and the counter does not move while a
 * sound is playing, so the whole of it is six ticks plus the music.
 *
 * Measured as the gap between the tick the port has him die and the tick
 * the words appear in the capture, across the five recordings that have
 * both: 25c4ebb8 46, 5920a8c2 47, 756b259c 47, 9b60bf3a 49, 13ab6867 52.
 * The spread is the drift between the two clocks and whatever else was
 * making a noise at the time. Forty-six is the low end and the one two
 * captures agree on.
 *
 * It was fifteen, from a reading of one capture that put the first blood
 * at tick 284 and the words at 298. That reading cannot be right: no
 * capture here has the words within forty ticks of a death.
 */
export const RESTART_PROMPT_DELAY = 46;

/**
 * Ticks after a death before Shift will start the level again:
 * `Kid.alive > 6`, and `Char.alive` is nought on the tick of the death.
 */
export const RESTART_BUTTON_DELAY = 6;

/**
 * Ticks from the button being pressed to the level running again. One:
 * the tick the button is read on is the tick the new level is drawn.
 *
 * It was three, read off a capture at three thousand cycles where the
 * words were up on tick 298 with Left already held, the screen was black
 * on 299 and 300, and the level was running again on 301. The two black
 * ticks are DOSBox redrawing, not the game -- see `ROOM_CHANGE_BLANK`.
 *
 * At twenty thousand cycles there is nothing between: in `probeF` the
 * death screen is on tick 430, the player's Shift is read on 431, and
 * 431 is already the new level's first frame. The frame after it is the
 * same picture again, which is the level's own opening tick.
 */
export const RESTART_DELAY = 1;

const TILE_SWORD = TILE.sword;
const TILE_POTION = TILE.potion;
const TILE_FLOOR = TILE.floor;

/** Sprite ids of the full and empty hit point markers in the Prince's group. */
const FULL_HP_IMAGE = 217;
const EMPTY_HP_IMAGE = 218;
const HP_TOP_Y = 194;

export { ROOM_COLUMNS };
