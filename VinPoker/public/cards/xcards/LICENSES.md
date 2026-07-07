# xCards face deck — provenance & license

These 52 playing-card **face** SVGs (`2C.svg` … `AS.svg`, rank + suit, ten = `T`) are the
operator/viewer card faces used when the `trackerCardFaces` feature flag is on. They render
through the shared `PokerCard` component (`src/components/cashier/tournament-live/PokerVisuals.tsx`).

- **Deck:** xCards — <https://github.com/Xadeck/xCards>
- **Original artwork:** "vector-cards" — <https://sourceforge.net/projects/vector-cards/>
  (split into single files and exported to SVG by the xCards project).
- **License:** **GNU LGPL v3** — full text in `LICENSE` in this folder.
- **Usage here:** VinPoker product UI card faces (tracker operator console + `/live` viewer +
  hand feed). Unmodified vector files, served as static assets from `public/cards/xcards/`.

## LGPL obligations we meet
- The full LGPL v3 text ships alongside the assets (`LICENSE`).
- Attribution to xCards + the original vector-cards artwork is recorded here.
- The files are unmodified and independently replaceable (swap the folder to change the deck),
  which satisfies the LGPL's "user can replace the library" requirement for a bundled component.

If the rights to this deck are ever in doubt, delete this folder and turn `trackerCardFaces`
OFF — `PokerCard` falls back to its built-in text face automatically.
