# Jo source and runtime artwork

Jo is an original character and original pixel art by Hyrum Butler. Character attribution links to [Hyrum's site](https://brazenbillygoat.github.io/mysite/).

The 17 Aseprite files in `source/` are the authoritative art sources. They remain at their authored 64-by-64 size. `source-manifest.json` records their exact SHA-256 hashes, frame counts, source durations, runtime role mapping, placement rules, and expected output hash.

Generate the runtime sheet from the repository root with:

```text
npm run assets:jo
```

Verify the checked-in sheet without writing with:

```text
npm run assets:jo:check
```

The dependency-free exporter validates the approved source files, excludes the `Guides` layer, composites visible normal artwork layers, scales pixels twofold with nearest-neighbor sampling, and expands source timing at a profile-wide 20 frames per second. It produces one transparent 3328-by-1152 PNG at `public/media/companions/jo/spritesheet.png`, arranged as 26 columns by nine 128-pixel role rows.

The runtime rows are stand, walk, sit, greet, crawl, climb, jump, fall, and drag. Canonical contact, transition, alternate-idle, and spin sources are intentionally preserved even though the current nine-role engine does not consume them directly.
