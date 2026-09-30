# FREEDOM × GTTEND RUN SESSION — 25s motion graphic

Concept: 25 s = 5 km. A running-watch HUD counts 0.00 → 5.00 KM; each km is a chapter:
opening (FREEDOM × GTTEND) → who we are (FREEDOM / GTTEND) → session info → session kit + how to join → deadline / finish.

- `deliverables/` — final 1080×1920 30fps MP4 (with sound / silent) and the Reels cover.
- `motion.js` — every frame is a pure function of time; open `index.html` through a local server for a live preview.
- `tools/prep_assets.py` — runner cutouts (rembg), background plate, vectorised logos.
- `tools/render.mjs` — headless Chromium → ffmpeg. `--dday D-2` adds a countdown badge on the deadline card.
- `tools/make_audio.py` — original 144 BPM track + SFX synced to `out/cues.json`.
- `assets/ai/` — Higgsfield (Kling) clips; `prep_assets.py clips` extracts them to frames for the hook, brand and end scenes.

Rebuild: `python3 tools/prep_assets.py && node tools/render.mjs --out out/v.mp4 && python3 tools/make_audio.py out/cues.json out/audio.wav`
then mux the audio with ffmpeg.
