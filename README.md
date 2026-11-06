# Prince of Persia 1 — browser port

Porting the 1989/1990 DOS game to run in a web browser.

* `original/prince1/` — the original DOS release, unmodified, exactly as shipped
  in `prince1.zip`.
* `docs/file-inventory.md` — **stage 1**: what every one of the 33 original files
  is for, how the engine chooses between the video-mode and sound-device
  variants, and the decoded on-disk formats (`.DAT` container, palettes, image
  headers, level records).
