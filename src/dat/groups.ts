/**
 * The sprite groups the original engine loaded, by file and starting resource
 * id. These ids are hard-coded in PRINCE.EXE; a group's header resource gives
 * the palette and says how many images follow it.
 */

export interface SpriteGroup {
  readonly file: string;
  /** Resource id of the shape-list header. */
  readonly header: number;
  /** How many images follow it, per the header byte. */
  readonly imageCount: number;
  readonly what: string;
}

export const SPRITE_GROUPS: readonly SpriteGroup[] = [
  // `what` is read by eye, off each group's own pictures, and checked
  // against the name the engine loads it under. Two of these were the
  // wrong way round for the whole life of the file -- 150 was called
  // the sword and 700 the flames -- and nothing noticed, because
  // nothing but a person reads the string: the engine loads a group by
  // its header number. `seg001`'s own calls are the second opinion:
  // `assets.group('PRINCE.DAT', 700, ROW.sword * 16)` and
  // `assets.group('PRINCE.DAT', 150, ROW.flame * 16)`.
  { file: 'PRINCE.DAT', header: 150, imageCount: 23, what: 'flames, potions, the loose sword, bubbles' },
  { file: 'PRINCE.DAT', header: 700, imageCount: 34, what: 'the sword in hand, and blood' },
  { file: 'TITLE.DAT', header: 40, imageCount: 5, what: 'the story frame, the four story screens, the credits' },
  { file: 'TITLE.DAT', header: 50, imageCount: 5, what: 'title screen' },
  { file: 'KID.DAT', header: 400, imageCount: 219, what: 'the Prince' },
  { file: 'FAT.DAT', header: 750, imageCount: 34, what: 'fat guard' },
  { file: 'SKEL.DAT', header: 750, imageCount: 28, what: 'skeleton' },
  { file: 'VIZIER.DAT', header: 750, imageCount: 34, what: 'Jaffar' },
  { file: 'SHADOW.DAT', header: 750, imageCount: 32, what: 'the Shadow' },
  { file: 'PV.DAT', header: 800, imageCount: 17, what: 'the princess in the story screens' },
  { file: 'PV.DAT', header: 850, imageCount: 38, what: 'Jaffar in the story screens' },
  { file: 'PV.DAT', header: 900, imageCount: 30, what: 'the princess in the cut-scenes' },
  { file: 'PV.DAT', header: 950, imageCount: 12, what: 'the princess room, and the hourglass' },
  { file: 'PV.DAT', header: 980, imageCount: 1, what: 'the princess asleep on her carpet' },
];

/** Tile sets: the same two group ids in every video-mode variant. */
export const TILESET_GROUPS = [
  { header: 200, what: 'room tiles' },
  { header: 360, what: 'wall pieces' },
] as const;

export const TILESET_FILES = [
  'VDUNGEON.DAT', 'VPALACE.DAT',
  'EDUNGEON.DAT', 'EPALACE.DAT',
  'CDUNGEON.DAT', 'CPALACE.DAT',
] as const;

/**
 * GUARD.DAT carries the ordinary guard's 34 sprites but no palette of its
 * own; GUARD1.DAT and GUARD2.DAT each hold just the shape-list header for it.
 */
export const GUARD_SPRITES = { file: 'GUARD.DAT', firstImage: 751, imageCount: 34 } as const;
export const GUARD_PALETTE_FILES = ['GUARD1.DAT', 'GUARD2.DAT'] as const;
