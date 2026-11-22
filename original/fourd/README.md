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
