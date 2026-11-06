/**
 * The coordinate system characters move in.
 *
 * Characters do not move in screen pixels. A room is 280 units wide, which
 * the renderer stretches to 320 pixels, and 14 units is half a tile. Rows
 * have their own ladder of floor heights. Keeping the original's units means
 * the original's movement tables land on the original's pixels.
 */

/** Half a tile, horizontally, in internal units. */
export const TILE_SIZE_X = 14;
export const TILE_MID_X = 7;
export const SCREEN_TILE_COUNT_X = 10;
/** Index of the room's first visible column within `X_BUMP`. */
export const FIRST_ONSCREEN_COLUMN = 5;

/** Left edge of each column, in internal units, for five rooms side by side. */
export const X_BUMP = [
  -12, 2, 16, 30, 44, 58, 72, 86, 100, 114,
  128, 142, 156, 170, 184, 198, 212, 226, 240, 254,
] as const;

/** Floor height of each row, in internal units; index is row + 1. */
export const Y_LAND = [-8, 55, 118, 181, 244] as const;

/** Internal x to screen x. 280 units of room become 320 pixels. */
export function toScreenX(logicalX: number): number {
  return Math.trunc((logicalX * 320) / 280);
}

/** Where a character standing on (column, row) has its origin. */
export function standX(column: number): number {
  return X_BUMP[column + FIRST_ONSCREEN_COLUMN] + TILE_SIZE_X;
}

export function standY(row: number): number {
  return Y_LAND[row + 1];
}
