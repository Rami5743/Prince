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
  { file: 'PRINCE.DAT', header: 150, imageCount: 23, what: 'sword and blood' },
  { file: 'PRINCE.DAT', header: 700, imageCount: 34, what: 'flame, potions, loose items' },
  { file: 'TITLE.DAT', header: 40, imageCount: 5, what: 'opening screen' },
  { file: 'TITLE.DAT', header: 50, imageCount: 5, what: 'title screen' },
  { file: 'KID.DAT', header: 400, imageCount: 219, what: 'the Prince' },
  { file: 'FAT.DAT', header: 750, imageCount: 34, what: 'fat guard' },
  { file: 'SKEL.DAT', header: 750, imageCount: 28, what: 'skeleton' },
  { file: 'VIZIER.DAT', header: 750, imageCount: 34, what: 'Jaffar' },
  { file: 'SHADOW.DAT', header: 750, imageCount: 32, what: 'the Shadow' },
  { file: 'PV.DAT', header: 800, imageCount: 17, what: 'cut-scene group 1' },
  { file: 'PV.DAT', header: 850, imageCount: 38, what: 'cut-scene group 2' },
  { file: 'PV.DAT', header: 900, imageCount: 30, what: 'cut-scene group 3' },
  { file: 'PV.DAT', header: 950, imageCount: 12, what: 'cut-scene group 4' },
  { file: 'PV.DAT', header: 980, imageCount: 1, what: 'cut-scene backdrop' },
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
