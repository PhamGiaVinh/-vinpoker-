# Tracker action sounds — provenance

| File | Source clip | Meaning (owner mapping) |
|---|---|---|
| pot-collect.mp3 | IMG_1360.MP4 | Gom chip vào pot |
| deal-turn-river.mp3 | IMG_1361.MP4 | Chia bài turn / river |
| fold.mp3 | IMG_1362.MP4 | Fold (bỏ bài) |
| deal-flop.mp3 | IMG_1363.MP4 | Mở flop 3 lá |
| check.mp3 | IMG_1364.MP4 | Check |

- **Source:** owner-provided clips (Telegram, 2026-07-08), supplied by the product owner
  for use as VinPoker product sound assets.
- **Usage:** VinPoker internal/product UI sound effects (tracker operator console + `/live` viewer).
- **Processing:** audio extracted from the MP4 clips with ffmpeg, silence-trimmed at the edges
  (−60 dB threshold, 0.3 s decay tail kept), mono 44.1 kHz, peak-normalized to −3 dBTP,
  encoded MP3 (libmp3lame `-q:a 3`).

If the rights to any source clip later turn out to be unclear, remove the corresponding
MP3 and this entry; the sound engine falls back to its procedural synth automatically.
