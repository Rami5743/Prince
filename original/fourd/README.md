# "4-D Prince of Persia", and exactly how much of it is new

`KIRILL.DAT` is the level file of a 1994 Russian modification of
Prince of Persia, released by the scene group Drink Or Die. Its own
`FILE_ID.DIZ` says

    4-D Prince Of Persia Ver.1
    100% new levels and FX!

and the "100%" is the only part of that which is not true. Measured
record by record against `original/prince1/LEVELS.DAT`:

    level    foreground tiles changed   room links changed
      1            0 of 720                   0 of 96
      2          423                         80
      3          616                         86
      4          570                         84
      5          501                         63
      6          484                         90
      7          463                         62
      8            0                          0
      9            0                          0
     10            0                          0
     11            0                          0

**Six levels are new -- 2 to 7 -- and five are the original's own.**
3057 of the eleven levels' 7920 tiles differ in all.

And it is **eleven levels**, not sixteen: the file is the same 37031
bytes with the same index at the same offset, but only resources
2000 to 2010 have a payload. 2011 and the four after it are written
as `id 0, offset 0, size 0`, so levels 12, 13, 14, Jaffar and the
princess are simply not in it.

    ours     16 entries, 2000..2015, every one 2305 bytes
    KIRILL   16 entries, 2000..2010 of 2305 bytes, then five blanks

So the page does not serve this file as `LEVELS.DAT`. It builds one:
the eleven records this file has, and **the original's own for the
five it has not**, which is the only way the game can be finished.
That is the same trick `levelsDatWithPotionLevel` plays with one
record, and it is done in memory -- neither file on disc is written
to.

The release also ships extra artwork its own patched executable
reads -- `EPALACE2/3/4.DAT`, `GUARD3/4/5.DAT`, `FAT2.DAT`,
`DIGISND4/5/6.DAT` -- which is the "FX" half of its claim. None of
it is here: this port loads the groups the original executable
loads, by the header numbers the original uses, and nothing in it
knows how the mod's own executable chose between them. **What is
offered is the mod's map, not the mod.**

## And the hour is still an hour, which is measured

The time, the hit points and the per-level tables are in the
**executable**, not in the level file, and the modification ships one
of its own -- `4D_PRIN.EXE`, 123340 bytes against this repository's
123335. So every constant the port reads out of an executable was
compared, one by one:

    startMinutesLeft          60   both
    startTicksLeft           719   both
    startHitPoints             3   both
    maxHitPointsAllowed       10   both
    levelType (16 entries)         identical
    guardHitPoints (16)            identical
    vgaPalette, demoMoves,
    checkpoint, skeleton,
    mirror, firstLevel, ...        identical

**Every one of the twenty-nine is identical.** So the hour is still
an hour, the Prince still starts with three flasks, and every level
is still the dungeon or the palace it always was.

The whole of what the modification patched is 107 bytes, and not one
of them is a number the game plays by:

    0x1ae28, 0x1ae93, 0x1aff3   "levels.dat" -> "kirill.dat", and
                                "LEVELS.DAT" -> "KIRILL.DAT"
    0x1aaca                     the cheat word "megahit" -> "kirill!"
    0x1b3e2                     "PRINCE OF PERSIA  V1.0"
                                -> "4D-PRINCE V1,Moscow 94"
    0x1b512                     "Loading. . " -> "Terebilov K...A"
    0x1d3bf                     the credit line -> "Hope you enjoyed
                                it - PC Cr(H)acker & BadSoft."

So **Kirill is a person**: Kirill Terebilov, and the level file is
named after whoever made it.

### The two that look like code are our own copy being cracked

Two runs differ that are not text -- `0x4a5f` and `0x4b72` -- and
they are not the modification's doing. Against all three
executables:

    0x4a5f   PRINCE.EXE (cracked)   eb 05 c7 46 06 0f
             UNCRKD.EXE             75 05 c7 46 06 0f
             4D_PRIN.EXE            75 05 c7 46 06 0f
    0x4b72   PRINCE.EXE (cracked)   90 90 90 90 90
             UNCRKD.EXE             c7 46 06 0f 00
             4D_PRIN.EXE            c7 46 06 0f 00

`4D_PRIN.EXE` is **UNCRKD.EXE's own bytes** at both: a `jnz` turned
into a `jmp`, and a `mov word [bp+6], 15` turned into five `nop`s,
are this repository's crack of the copy protection. The modification
was built on the uncracked release and keeps it
(`copyProtectionLevel` is 2 in all three).
