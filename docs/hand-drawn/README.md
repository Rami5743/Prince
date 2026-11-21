# One sprite drawn by hand

`kid-437.svg` is KID.DAT sprite 437 -- the Prince's running stride,
facing left, 37 by 39 pixels -- drawn shape by shape rather than
traced by `src/render/vectorize.ts`. The player rejected the tracer's
output twice ("still very pixelated and with noise", then
"shocking"), so this is what the same frame looks like when the
anatomy is drawn instead of the outline followed.

## How it was drawn

1. **The grid was read first.** Every one of the 466 lit pixels, by
   row, with its palette index -- the gold of the hair, the two skin
   shades, the cream of the tunic and its one shade. The pose was
   then named part by part: the head in profile with the nose at
   x 7, the near arm bent with the fist at the chest, the far arm
   swung back to x 25, the sleeveless tunic leaning down-right, the
   seat, the leading leg swinging down-left to the foot at x 1, the
   trailing leg stretched right to the boot at x 36.
2. **The silhouette is measured, the line between is drawn.** Each
   part's extent was taken off the grid column by column -- the
   tunic is six pixels wide at the collar and nine at the hem; the
   far arm is five wide to the elbow at (21, 13) and three after it;
   the trailing leg's top edge is flat at row 26 to x 27 and then
   drops. The curves between those measurements are judgement.
3. **It was corrected against the original, six times.** Each pass
   rasterized the drawing at 37 by 39 in Chromium and printed the
   two silhouettes one over the other, marking every pixel the
   original has and the drawing has not (`o`) and every pixel the
   drawing added (`+`). The first pass read

       both 428   missing 38   spilled 85

   and the errors were not where the eye had said: the seat bulged
   two pixels too far left from row 19, the fist sat two rows too
   high, the far arm ran two rows past the original's hand. The last
   reads

       both 439   missing 27   spilled 63

   of the original's 466. The remainder is deliberate: a drawn figure
   smooths the single-pixel steps the artist used for dithering, and
   it rounds a heel the grid draws square.

## What the hand does that the tracer cannot

* **It knows what a part is.** The tracer sees a region of index 6
  and follows its boundary; the hand knows the region is a forearm,
  so it tapers from elbow to wrist, puts a fist on the end and
  leaves a gap between the fist and the chest.
* **It can add what the grid only implies.** The knee crease, the
  fold across the chest, the ankle, the ear -- each is one or two
  pixels in the original, or nothing at all, and each is drawn
  because a running figure has one.
* **It can refuse the grid.** The dither along the Prince's edge is
  the artist working round sixteen colours; the drawing leaves it
  out rather than tracing it as islands, which is what the player
  called noise.

## What it costs

About two hours of looking for one frame of 218, and the result is
one pose: nothing here generalizes to frame 438. That is the finding
rather than a complaint -- it says what a hand-drawn set of the
Prince's artwork would actually be, and it is why the tracer exists.

Every colour is one of the sprite's own palette entries, so the
figure still fades and flashes with the game's palette:

    gold        1   #BA9200      hair dark   4   #795D38
    brow        2   #8A554D      skin        6   #DF826D
    skin shade  5   #B27161      cloth      15   #FFFFDB
    cloth shade 7   #DBBAA2
