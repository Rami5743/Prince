# The five files Prince of Persia 1.4 draws differently

1.4 is the last DOS release. Its **levels are the 1.0 levels**: the
player supplied a copy and `LEVELS.DAT` compares **byte for byte
identical** to `original/prince1/LEVELS.DAT`, so the map, the hour,
the hit points and the starting positions are all unchanged. What
the later release really changed is the artwork and the palettes,
and these are the only files that differ and that the port reads:

    PRINCE.DAT     3278 -> 25600 bytes
                   one resource differs (1, which nothing here reads)
                   and two are NEW: 20 and 65535.
                   **Resource 20 is 240 bytes: five palettes of
                   sixteen** -- `level_var_palettes`, the alternate
                   level colours 1.0 has not got at all.
    VDUNGEON.DAT   72 of its 218 resources differ: the dungeon
                   redrawn and recoloured
    VPALACE.DAT    14 of 238
    TITLE.DAT      3 of 12, one of them resource 51, the title
                   screen itself
    SKEL.DAT       5 of 29

Identical in both releases and therefore not copied here:
`KID.DAT`, `GUARD.DAT`, `GUARD1/2.DAT`, `PV.DAT`, `VIZIER.DAT`,
`SHADOW.DAT`, `FAT.DAT`, `IBM_SND1/2.DAT` and `LEVELS.DAT`.

**The PC speaker tunes are identical**, which is worth knowing: the
"altered music" of the later releases is in `MIDISND*` and
`DIGISND*` only, and those are not copied here because the port's
sound is measured against 1.0's captures.

1.4 also deletes `CDUNGEON.DAT`, `CPALACE.DAT`, `EDUNGEON.DAT` and
`EPALACE.DAT` -- it forces VGA -- and adds `SETUP.EXE`, `SETUP.CFG`
and a `SNDDRVRS` directory, none of which a browser needs.
