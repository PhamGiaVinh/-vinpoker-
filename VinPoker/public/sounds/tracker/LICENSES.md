# Tracker action sounds — provenance

| File | Source clip | Meaning (owner mapping) |
|---|---|---|
| pot-collect.mp3 | IMG_1360.MP4 | Gom chip vào pot |
| deal-turn-river.mp3 | IMG_1361.MP4 | Chia bài turn / river |
| fold.mp3 | IMG_1362.MP4 | Fold (bỏ bài) |
| deal-flop.mp3 | IMG_1363.MP4 | Mở flop 3 lá |
| check.mp3 | IMG_1364.MP4 | Check |
| pot-award.mp3 | IMG_2431.MP4 | Trao pot cho người thắng |

- **Source:** owner-provided clips (Telegram, 2026-07-08), supplied by the product owner
  for use as VinPoker product sound assets. `IMG_2431.MP4` was supplied on 2026-09-12.
- **Usage:** VinPoker internal/product UI sound effects (tracker operator console + `/live` viewer).
- **Processing:** audio extracted from the MP4 clips with ffmpeg, silence-trimmed at the edges
  (−60 dB threshold, 0.3 s decay tail kept), mono 44.1 kHz, peak-normalized to −3 dBTP,
  encoded MP3 (libmp3lame `-q:a 3`).
- **pot-award.mp3 revision (2026-09-14):** preserves the complete 1.72-second audio
  track of IMG_2431.MP4 (no internal silence removal), +10 dB gain from the original
  -13.3 dB peak, 8 ms fade-in / 70 ms fade-out, mono 44.1 kHz MP3. This replaces
  the earlier truncated 0.86-second cue. Tracker playback volume is 1.0.

If the rights to any source clip later turn out to be unclear, remove the corresponding
MP3 and this entry; the sound engine falls back to its procedural synth automatically.
