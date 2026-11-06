# Prince of Persia 1 (DOS) — Inventory of the Original Files

Source archive: `prince1.zip`, 33 files, unpacked into `original/prince1/`.
This is the Broderbund PC release v1.0 (most `.DAT` files are dated 1990-03-29),
repackaged by a fan site (see `README.TXT`) with a cracked `PRINCE.EXE` plus two
third-party tools added.

Everything below was checked against the files themselves: every resource index
was walked, the checksums were recomputed, the level record layout was validated
against level 1, and the string/pointer tables inside `PRINCE.EXE` were read to
confirm which file the engine loads when. Where something was *not* verified it
says so.

---

## 1. Master table

| File | Size | Date | Role |
|---|---:|---|---|
| `PRINCE.EXE` | 123 335 | 2011-07-01 | **The game itself.** 16-bit DOS MZ executable. A cracked copy of `UNCRKD.EXE` with the copy-protection screen patched out. This is what `CHEATS.BAT` runs. |
| `UNCRKD.EXE` | 123 335 | 1990-03-29 | The original, unmodified executable, with the "type the word from the manual" protection still active. Differs from `PRINCE.EXE` in exactly 115 bytes (see §5). |
| `POPTRAIN.EXE` | 42 896 | 2004-08-19 | Third-party save-game editor ("PoPTrain"), written in Turbo Pascal. Edits `PRINCE.SAV`: remaining minutes (1–255), starting level (1–12), health bars (1–255). Not part of the original game. |
| `INSTALL.EXE` | 11 445 | 1990-07-10 | Broderbund's "Hard Disk Install Program". Copies the floppy contents to `C:\PRINCE`, then deletes itself. Not needed by the game. |
| `INSTALL.PDM` | 4 233 | 1990-03-21 | The same installer as a **Tandy DeskMate** application (links `DMSPELL`/`DMCSR`; contains "DeskMate error initializing Prince of Persia"). Not needed by the game. |
| `CHEATS.BAT` | 18 | 2004-08-19 | One line: `prince.exe megahit` — starts the game with the built-in cheat mode on. Added by the repackager. |
| `README.TXT` | 519 | 2011-09-16 | Notes from the repackager (popuw.com) explaining the cracked exe, `CHEATS.BAT` and `POPTRAIN.EXE`. |
| `CHKLIST.MS` | 54 | 1996-02-20 | Leftover junk: a Microsoft Anti-Virus (MS-DOS 6 `MSAV`) checksum record for `INSTALL.EXE` and `PRINCE.EXE`. Irrelevant to the game. |
| `PRINCE.DAT` | 3 278 | 1990-03-29 | Core resource file, always loaded. Holds the **sword sprite set** (group header id 150 + 23 images) and the **item sprite set** — flame, potions, sword on the floor (header id 700 + 34 images), plus three resources that are neither images nor group headers: **id 10 is the guard colour palettes** — seven 16-colour tables, one per guard colour, which the game loads over the guard's own palette so that each room's guard wears different clothes; ids 1 and 2 are still **not identified**. The game's text font is not here — it is built into `PRINCE.EXE`. |
| `LEVELS.DAT` | 37 031 | 1990-03-29 | **All 16 level maps** (ids 2000–2015): tile map, room links, door links, guard placement, start position. Fully decoded in §3. |
| `KID.DAT` | 37 149 | 1990-03-29 | All animation frames of the **Prince** (the "Kid") — palette id 400 + 219 sprites, ids 401–619. |
| `GUARD.DAT` | 6 950 | 1990-03-29 | Sprite set of the ordinary **guard**, ids 751–784. The only character file with no palette of its own (it uses `GUARD1/2.DAT`). |
| `FAT.DAT` | 6 521 | 1990-03-29 | Sprite set of the **fat guard**, palette id 750 + ids 751–784. |
| `SKEL.DAT` | 3 864 | 1990-03-29 | Sprite set of the **skeleton**, palette id 750 + ids 751–778. |
| `VIZIER.DAT` | 6 111 | 1990-03-29 | Sprite set of **Jaffar** as an in-level opponent, palette id 750 + ids 751–784. |
| `SHADOW.DAT` | 4 715 | 1990-03-29 | Sprite set of the **Shadow** (the Prince's doppelgänger), palette id 750 + ids 751–782. |
| `GUARD1.DAT` | 117 | 1990-03-29 | Nothing but a single palette (id 750) — guard colour set #1. |
| `GUARD2.DAT` | 117 | 1990-03-29 | The same, colour set #2. The engine loads one of the two per level. Note: the 16 **VGA** colours in the two files are byte-identical — they differ only in their CGA and EGA tables (21 differing bytes, all at payload offset ≥ 55). For a VGA-only port the two files are interchangeable. |
| `PV.DAT` | 25 829 | 1990-03-29 | **Cut-scene graphics** — five groups, each opening with its own 100-byte palette: ids 800, 850, 900, 950 and 980. Id 981 is a 240 × 41 backdrop. These are the story scenes (Princess, Jaffar, the hourglass room). "PV" is normally read as Princess/Vizier. |
| `TITLE.DAT` | 36 725 | 1990-03-29 | **Title sequence.** Two groups, each with its own palette: ids 40–45 and ids 50–55. Ids 41 and 51 are both full 320 × 200 screens; the rest are smaller overlays (logo words, credit lines). |
| `VDUNGEON.DAT` | 14 220 | 1990-03-29 | **Dungeon** tile set + palette — **VGA/MCGA** version. |
| `VPALACE.DAT` | 14 226 | 1990-03-29 | **Palace** tile set + palette — **VGA/MCGA** version. |
| `EDUNGEON.DAT` | 10 165 | 1990-03-29 | Dungeon tile set — **EGA / Tandy** version. |
| `EPALACE.DAT` | 13 876 | 1990-03-29 | Palace tile set — **EGA / Tandy** version. |
| `CDUNGEON.DAT` | 9 407 | 1990-03-29 | Dungeon tile set — **CGA / Hercules** version. |
| `CPALACE.DAT` | 12 889 | 1990-03-29 | Palace tile set — **CGA / Hercules** version. |
| `IBM_SND1.DAT` | 3 684 | 1990-03-29 | **PC speaker**, bank 1 — ids 10000–10043, all 44 of them. |
| `IBM_SND2.DAT` | 3 784 | 1990-03-29 | **PC speaker**, bank 2 — ids 10044–10056, all 13. Includes the long ending tune (id 10056). |
| `DIGISND1.DAT` | 48 545 | 1990-04-26 | **Digitised (PCM)** sound, bank 1 — 20 of the 24 effects in 10000–10023. |
| `DIGISND3.DAT` | 31 000 | 1990-04-26 | **Digitised** sound — exactly the 4 effects missing from `DIGISND1.DAT` (ids 10001, 10014, 10015, 10018). It completes bank 1 rather than replacing anything. |
| `DIGISND2.DAT` | 29 143 | 1990-03-29 | **Digitised** sound, bank 2 — ids 10044–10049 and 10051 (the speech-like cut-scene sounds). |
| `MIDISND1.DAT` | 9 368 | 1990-03-29 | **AdLib / MIDI music**, bank 1 — 16 pieces in the range 10024–10043. |
| `MIDISND2.DAT` | 18 408 | 1990-03-29 | **AdLib / MIDI music**, bank 2 — ids 10050 and 10052–10056, i.e. exactly the ids `DIGISND2.DAT` does *not* carry. Includes the ending piece (id 10056, 12 773 bytes). |

Created at run time, not present in the archive: **`PRINCE.SAV`** — the save file
(level, minutes, health), written by the game and edited by `POPTRAIN.EXE`.

---

## 2. How the engine chooses between the variants

### 2.1 Graphics — the file-name prefix table

`PRINCE.EXE` builds the tile-set file name from the format string `%s%s.DAT`,
where the first `%s` is a one-letter prefix taken from a table indexed by video
mode and the second is `DUNGEON` or `PALACE`. The table in the exe reads
`"" , "C", "C", "E", "E", "V"`, and the mode-name table immediately above it
reads `CGA, HERCULES, EGA, TANDY, MCGA/VGA`:

| Video mode | Prefix | Files used |
|---|:--:|---|
| `CGA` | `C` | `CDUNGEON.DAT`, `CPALACE.DAT` |
| `HERCULES` | `C` | `CDUNGEON.DAT`, `CPALACE.DAT` |
| `EGA` | `E` | `EDUNGEON.DAT`, `EPALACE.DAT` |
| `TANDY` | `E` | `EDUNGEON.DAT`, `EPALACE.DAT` |
| `MCGA/VGA` | `V` | `VDUNGEON.DAT`, `VPALACE.DAT` |

Only the level tile sets are duplicated per mode. `KID.DAT`, `GUARD.DAT`,
`FAT.DAT`, `SKEL.DAT`, `VIZIER.DAT`, `SHADOW.DAT`, `PRINCE.DAT`, `TITLE.DAT` and
`PV.DAT` exist in one version only — every palette resource carries VGA, CGA
*and* EGA colour tables side by side (§3.2), so one sprite file serves all modes.

The mode can be forced on the command line: `vga`, `mcga`, `tga`, `ega`, `hga`,
`herc`, `cga`.

### 2.2 Sound — three parallel banks over one id space

All seven sound files use the **same resource id space**, so a sound is requested
by id and resolved in whichever family is active. The split is exact, with no
overlap and no gaps:

| Id range | What it is | PC speaker | Digital | AdLib / MIDI |
|---|---|---|---|---|
| 10000–10023 | sound effects | `IBM_SND1` | `DIGISND1` + `DIGISND3` | — (effects are not synthesised) |
| 10024–10043 | in-game music | `IBM_SND1` | — | `MIDISND1` (16 of the 20; ids 10031, 10034, 10038, 10042 are PC-speaker-only) |
| 10044–10056 | cut-scene audio | `IBM_SND2` | `DIGISND2` (speech-like) | `MIDISND2` (musical) |

So `DIGISND2` + `MIDISND2` together cover 10044–10056 exactly once each, and
`DIGISND1` + `DIGISND3` together cover 10000–10023 exactly once each. Nothing is
a "better version" of anything else — the files are complementary.

Sound-driver names found in the exe: `stdsnd`, `adlib`, `covox`, `gblast`,
`ibmg`, `sblast`, `tandy`.

### 2.3 Command-line words in `PRINCE.EXE`

`megahit` (cheat mode — what `CHEATS.BAT` uses), `bypass`, `unpack`, plus the
seven video-mode words above.

---

## 3. File formats (verified)

### 3.1 The `.DAT` container

All 25 `.DAT` files share one archive format:

```
offset 0 : uint32  index_offset
offset 4 : uint16  index_size
...
at index_offset:
           uint16  item_count
           item[item_count], 8 bytes each:
             uint16 resource_id
             uint32 offset
             uint16 size
at each item's offset:
           uint8   checksum
           uint8   payload[size]
```

* Resources are packed back to back: the next one starts at `offset + size + 1`.
* `(checksum + sum(payload)) mod 256 == 0xFF`. Recomputed for every level
  resource; holds in all 16.
* `index_size == 2 + 8 * item_count` in every file.

### 3.2 Shape-list payload — 100 bytes

A sprite group begins with one of these; the images follow it at consecutive
ids. The group ids are hard-coded in `PRINCE.EXE`: 40 and 50 in `TITLE.DAT`,
150 and 700 in `PRINCE.DAT`, 200 and 360 in every tile set, 400 in `KID.DAT`,
750 in each enemy file, and 800/850/900/950/980 in `PV.DAT`.

| Offset | Size | Content |
|---:|---:|---|
| 0 | 1 | number of images in the group |
| 1 | 2 | row bits |
| 3 | 1 | colour count (always 16) |
| 4 | 48 | 16 × RGB, 6-bit components (0–63), VGA |
| 52 | 16 | CGA colour table |
| 68 | 32 | EGA colour table |

One resource therefore carries the colours for every video mode at once. The
image count is checked in the test suite against the ids that actually follow:
`KID.DAT` 400 says 219 and ids 401–619 are exactly 219 images.

`GUARD1.DAT` and `GUARD2.DAT` consist of nothing but this header; the 34
images it counts live in `GUARD.DAT`, which has no header of its own.

Unused slots inside a group are stored as a two-byte payload of zeroes — a
height of 0. `VDUNGEON.DAT` has 88 of them among its 151 room tiles.

### 3.3 Image / sprite payload

```
uint16 height
uint16 width            pixels
uint16 flags
uint8  data[]

depth  = ((flags >> 12) & 7) + 1       bits per pixel
method = (flags >> 8) & 0x0F           compression scheme
stride = (depth * width + 7) >> 3      bytes per packed row
```

| method | scheme |
|---:|---|
| 0 | raw |
| 1 | RLE, row-major |
| 2 | RLE, column-major |
| 3 | LZ, row-major |
| 4 | LZ, column-major |

The RLE is a signed count byte: `n >= 0` copies `n+1` literals, `n < 0`
repeats the next byte `-n` times. The LZ is LZ77 over a 1 KiB ring buffer
whose write cursor starts at `0x400 - 0x42`; a rolling bit mask selects
literal or back-reference, and a back-reference is a big-endian word holding a
10-bit window offset and a 6-bit length biased by 3.

All five methods appear in the shipped data. The tile sets mix 16-colour
images with a few 1-bit masks (nine of the seventeen palace wall pieces are
masks), so a renderer must handle both depths.

This decoder is verified end to end: decoding `TITLE.DAT` resource 51 with
palette 50 reproduces a DOSBox capture of the real game's title screen with
**zero** differing pixels out of 64 000 (see `tests/oracle/`).

### 3.4 Level payload — 2305 bytes (`LEVELS.DAT`, ids 2000–2015)

Layout confirmed against level 1, which reads back as `used_rooms = 24`,
`start_room = 1`, `start_pos = 0`, `start_dir = -1` (facing left) — the real
starting point of level 1.

| Offset | Size | Field |
|---:|---:|---|
| 0 | 720 | `fg` — foreground tile, 24 rooms × 30 tiles |
| 720 | 720 | `bg` — background / modifier byte per tile |
| 1440 | 256 | `doorlinks1` |
| 1696 | 256 | `doorlinks2` |
| 1952 | 96 | `roomlinks[24][4]` — left / right / up / down neighbour of each room |
| 2048 | 1 | `used_rooms` |
| 2049 | 24 | `roomxs` |
| 2073 | 24 | `roomys` |
| 2097 | 15 | padding (`0xFF`) |
| 2112 | 1 | `start_room` |
| 2113 | 1 | `start_pos` |
| 2114 | 1 | `start_dir` (signed) |
| 2115 | 4 | padding |
| 2119 | 168 | guards — `tile`, `dir`, `x`, `seq_lo`, `skill`, `seq_hi`, `colour`, 24 entries each |
| 2287 | 18 | padding (`0xFF`) |

Id → level: **2000 = the demo level**, **2001–2014 = levels 1–14**,
**2015 = level 15** (the "potions" level).

One quirk to carry into a port: resource **2015 is 2304 bytes**, one short of the
other fifteen. The final padding byte is simply missing from the original file,
so a reader that insists on 2305 bytes will fail on the last level.

---

## 4. What this means for a browser port

| Group | Needed? |
|---|---|
| `PRINCE.EXE` / `UNCRKD.EXE` | Only as the **reference for the game logic** (or to run under an x86 emulator). Not shipped if the engine is rewritten. |
| `LEVELS.DAT` | **Yes** — and it is the easy part: fixed-size uncompressed records, fully decoded above. |
| `VDUNGEON.DAT`, `VPALACE.DAT`, `KID.DAT`, `GUARD/FAT/SKEL/VIZIER/SHADOW.DAT`, `PV.DAT`, `TITLE.DAT`, `PRINCE.DAT` | **Yes** — all the artwork. The real work is the sprite decompressor (§3.3). The VGA (`V`) tile sets are enough. |
| `GUARD1.DAT`, `GUARD2.DAT` | **Yes** — 117 bytes each, just palettes. |
| `DIGISND1/2/3.DAT` | **Yes** — the PCM bank, convert to WAV/OGG. |
| `MIDISND1/2.DAT` | Optional — needs AdLib (OPL2) emulation, but it is the music most players remember. |
| `IBM_SND1/2.DAT` | Optional — PC-speaker fallback only. |
| `C*.DAT`, `E*.DAT` | **No** — CGA/EGA/Hercules/Tandy artwork. |
| `INSTALL.*`, `CHKLIST.MS`, `CHEATS.BAT`, `POPTRAIN.EXE`, `README.TXT` | **No** — DOS installation, anti-virus leftovers, third-party tools. |

That is **11 of the 33 files** for a minimal port, 13 with music.

---

## 5. Appendix — what the crack changed

`PRINCE.EXE` and `UNCRKD.EXE` differ in exactly 115 bytes, in three places
(file offsets, not memory addresses):

1. **19040** — `75 05` (`JNZ +5`) becomes `EB 05` (`JMP +5`): the result of the
   protection check is never tested.
2. **≈19296–19319** — the code that set up the protection screen is replaced;
   five `90` (`NOP`) bytes appear at 19313–19317 and a far jump is inserted.
3. **≈109142** — the string
   `MS Run-Time Library - Copyright (c) 1988, Microsoft Corp` is overwritten by
   the relocated tail of the patched routine, followed by the cracker's tag
   `RBM/THG`.

No `.DAT` file is touched, so both executables work with the same data.
