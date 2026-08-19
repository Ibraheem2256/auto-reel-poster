# Video Editor Feature — Progress (2026-08-18)

## ✅ DONE

1. **Real background removal (AI person cut-out)**
   - Model: RVM (Robust Video Matting) mobilenetv3 fp32 ONNX (~15 MB) at `models/rvm_mobilenetv3_fp32.onnx`
   - Runtime: `onnxruntime-node` (native, works on Windows, tested)
   - Pipeline tested end-to-end: ffmpeg extracts frames → RVM mattes each frame → PGM masks → ffmpeg composites (blur / solid color bg)
   - Code: `lib/bg-removal.ts` (extractPersonMasks, bgRemovalAvailable, maskSequencePattern, cleanupMasks, ensureModelDownloaded, getRvmSession)
   - Note: model input must be **0-255** range (not /255 normalized) — verified by testing
   - ~235ms/frame @540x960, mattes computed at ~1/4 res then upscaled

2. **Edit spec (per-video settings)**
   - `lib/editor-spec.ts` — types + presets + normalizeEditSpec()
   - `EditSpec`: trim, filter preset, custom filter, effects (zoom-intro, ken-burns, shake, bounce), text overlays (animated), music (track/volume/fades), background removal, progress bar, `motion` (MotionSpec)
   - Prisma: `Video.editSpec Json?` added + `npx prisma db push` done

3. **Spec-driven renderer**
   - `lib/editor.ts` rewritten — editVideoForPublish accepts `spec`, `preview`, `maxSeconds`, `sourceFileOverride`
   - Filters: vivid, noir, vintage, warm, cool, cinematic, dreamy presets + custom eq
   - Effects via zoompan / crop expressions (fixed: no `eval=frame` on crop — x/y are per-frame by default in this build)
   - Text overlays via drawtext with animated alpha (verified animating in test)
   - Progress bar via drawbox eval=frame
   - Music: chosen track (no more random), volume + fade in/out
   - Trim: `-ss` input seek + -t
   - Verified drawtext alpha animation works (framemd5 test)

4. **AI-powered Motion Graphics & Effects Engine** (`lib/motion/*`) — "MOTION GRAPHICS + TEXT ANIMATION + 3D EFFECTS — IMPLEMENTED ✅"
   - **analyze.ts** — beat detection from audio PCM (energy peaks + adaptive threshold, BPM, confident flag), frame-diff motion energy, FULL-SUBJECT tracking via RVM alpha mattes (whole person, not just face; downsampled 144x256, median-smoothed, gap-filled, ~4-15 samples/s). `analyzeMotion` never throws (fallback-safe).
   - **select.ts** — `createMotionDesign`: deterministic AI selector. Content-fit rules per video type (action/talking-head/motivational/emotional/tutorial/comedy/generic), style picker (`pickStyle`: modern-cinematic default; dynamic-punchy, clean-minimal, energetic-pop), intensity (subtle/smart/aggressive), restraint rules (no shake under 2s, no ramps on talking-heads, letterbox only for cinematic/motivational, etc.), beat-synced camera paths, speed ramps, punch-ins, impact shake, overlays (glow/rays/particles/letterbox/vignette/grain), parallax + behind-subject text when tracked, per-text 3D treatment (entrance flip/spin/slam/rise3d/fade, kinetic word-by-word reveal, subject-follow), synced SFX (pop/impact), `changes` + `notes` explanations. Timeline mapping (source → final seconds after cuts).
   - **render.ts** — ffmpeg 6.1-validated graph builders:
     - Camera: overscale + animated `crop` x/y (cubic partition-of-unity keyframes + gaussian beat/punch pulses + decaying-sine shake) — no `eval` needed (x/y are per-frame by default)
     - 3D text: separate rgba track layers (dark extrusion copies, entrance scale/rotate via `eval=frame`, static `perspective` tilt, kinetic staggered prefixes, accent highlight, subject-follow via subsampled track expr ≤28 samples + camera-window correction)
     - Segments: cuts + speed ramps (setpts/atempo chains, minterpolate for slow-mo ≤0.6 outside preview), chained xfade/acrossfade transitions, white/black flash layers
     - Overlays: glow (screen-blend gblur), rotating light rays, particles (dust/spark via noise), letterbox, vignette, grain, flashes; motion trails via `tmix`
   - **Render integration** (`lib/editor.ts`): `EditSpec.motion` → pieces (cuts+ramps) replace legacy cut concat; layer order = pieces → bg(parallax)+behind-texts → subject → trails → camera → grade → overlays → front-texts → canvas scale/fades; motion SFX merged; masks reused from RVM when pieces are trivial; loop wrap + pacing still applied.
   - **AI edit pipeline wired**: `pipeline.ts` runs `analyzeMotion` after signal analysis; `plan.ts` runs `createMotionDesign` (non-targeted actions) and merges spec.motion + changes/notes + synced SFX into the plan; `computeExpectedDuration` accounts for speed ramps.
   - **API**: `POST /api/videos/[id]/motion-design` (SSE stages → design JSON) — analyze + design without rendering.
   - **UI**: editor "Motion FX" tab — enable toggle, 4 styles w/ descriptions, intensity, "Generate AI motion design", applied-design chips, explainable changes + analysis summary (beats/BPM/subject).
   - **Verified**: `scripts/test-motion.ts` (`npm run test:motion`) renders smoke-src.mp4 end-to-end: 19 beats @120BPM, 19 subject samples, design applied, 5.00s preview 540x960 with letterbox (top rows black YMAX 16) + white 3D text present (YMAX 247 at text rows). `npm run typecheck` ✅, `npm test` ✅ 70 passed (23 new motion tests).

5. **API routes**
   - `GET/PUT /api/videos/[id]/edit` — get/save edit spec
   - `POST /api/videos/[id]/render` — SSE progress + sentinel `\0ARPREND\0` + binary mp4 (preview 540x960)
   - `POST /api/videos/[id]/motion-design` — SSE design (analyze + AI design)
   - `GET /api/music` + `GET /api/music/[name]` — list + stream tracks
   - `GET /api/videos/[id]/stream` — Drive proxy with Range support (for editor preview player)

6. **Editor UI** — `app/(dashboard)/editor/[id]/page.tsx`
   - Preview player (CSS filter/effect/text approximation)
   - Trim timeline (sliders + numeric)
   - Tabs: Filters, Effects, Text & motion, **Motion FX (new)**, Music, Background, AI Edit
   - Save + Render preview buttons, render progress overlay, rendered video playback

7. **Publish path wired** — `lib/scheduler.ts` runJob + publishVideoNow pass `video.editSpec` to editor

8. **Queue page** — added "Edit" button linking to `/editor/[id]`

## ⏳ REMAINING

1. **Browser test** — dev server was stopped, RESTART: `npm run dev`
   - Test: /queue → Edit → Motion FX → Generate → Render preview → verify mp4 output
   - Test bg removal render (takes 1-2 min)
2. **Consider**: auto-download model if missing (`ensureModelDownloaded` exists but not called anywhere yet — call it in render route or a setup script)
3. **Optional**: add Edit link on /drive + /posts pages too
4. **Optional**: update README/settings copy to mention new editor
5. **Cleanup**: `models/selfie_segmenter.tflite` (unused, 250KB) can be deleted; `@mediapipe/*` already uninstalled
6. **DEPLOYMENT note**: onnxruntime-node + RVM model must exist on server — Vercel serverless may need the model in repo (it is, in `models/`) and native module (check if Vercel supports onnxruntime-node; may need a VPS/self-host for bg removal; ffmpeg already assumed server env)

## 🐛 Production failures fixed (real 720x1280 video)

The first real-video render hit two crashes; both are fixed and reproduced+verified:

1. **"No such filter: ''"** (`[cam][gradM]`) — `filterChain()` returns `string[]`, but the motion grade path treated it as a string (`if (filterChainFx)` is always truthy for arrays, and string interpolation of `[]` yields ""). Fix: `if (filterChainFx.length) … filterChainFx.join(",")` (lib/editor.ts:592).
2. **Access violation (code 3221225477)** — ffmpeg 6.1 crash in the **background parallax filter** (only active when subject masks exist, so the 320x640 smoke test never exercised it):
   `scale=w='iw*(1+drift+0.02*sin(t/3.1))'…eval=frame,crop=W:H:x='(iw-W)/2+drift*W*sin(t/4.2)'…`
   The scale expression dips **below 1.0** (cos(t/2.6) < 0 after t≈4s → scaled height < crop height) and the drift offset (±drift·W px) equals the entire pan margin — the crop window goes out of bounds at runtime; per-frame size change + OOB crop → native crash on encode.
   Fix (lib/editor.ts:557): `scale=w='iw*max(1.0,(1+drift+0.02*sin(t/3.1)))'` and crop x/y clamped: `x='max(0,min(iw-W,(iw-W)/2+…))'`.
3. **Defensive fixes found via repro**: `applyOverlays` now handles `flashes` missing (`o.flashes?.length`, lib/motion/render.ts:533) and film grain clamps to noise's max `alls=100` (lib/motion/render.ts:528).

Verified: full repro of both failing production chains on a synthetic 720x1280 clip renders 6.40s 540x960 with audio; `npm test` 70 passed; `npm run test:motion` PASS; `tsc --noEmit` clean. (Repro scripts were temporary and deleted.)

## 🐛 Bug 3 fixed: flashes (and overlay timing) silently never rendered

Pixel-verified every overlay layer for the first time (signalstats strip analysis) and found the white-flash overlay contributed **nothing**: ffmpeg 6.1's `overlay` **drops the second input's frames whenever that input's timestamps are shifted with `setpts`** (and `fade=t=out` on an infinite color source emits black frames that linger). Fixed in lib/motion/render.ts: the flash canvas is now a **finite** `color=white:d=0.4,format=rgba` with alpha fades, delayed into position with **`tpad=start_duration=<at>:color=black@0`** (transparent start frames), and the overlay uses **`eof_action=pass`** so the main video continues cleanly. Verified: YAVG 49 → 206 (peak) → 144 (fade-out) → 49. Also wired `motion.transitions.flashAt` (generated by select.ts for punchy/cinematic styles but previously dead) into the flash renderer. Texts/glow/letterbox/vignette/grain verified rendering via pixel deltas.

## ✨ Showcase demo

`scripts/showcase-edit.ts` → **`showcase-edit.mp4`** (5.60s, 540x960, audio): hand-tuned cinematic cut of smoke-src.mp4 — 4 pieces with 0.5× slow-mo + 1.4× fast + xfade; camera push/pull + punch-in + beat pulse + impact shake; slam / kinetic-rise3d / flip 3D text with extrusion + perspective; glow + letterbox + vignette + grain + white flash; motion trails; parallax subject composite; 6 beat-synced SFX + music ducking.

## Files touched (this session)
- NEW: lib/motion/types.ts, lib/motion/analyze.ts, lib/motion/select.ts, lib/motion/render.ts, app/api/videos/[id]/motion-design/route.ts, tests/motion.test.ts, scripts/test-motion.ts
- EDITED: lib/editor.ts (motion render path + crop eval fix), lib/editor-spec.ts (motion field + normalizeMotionSpec), lib/ai-edit/plan.ts (motion design step), lib/ai-edit/pipeline.ts (analyzeMotion + expected duration), lib/ai-edit/types.ts (category "motion"), lib/bg-removal.ts (export getRvmSession), app/(dashboard)/editor/[id]/page.tsx (Motion FX tab), package.json (test:motion)
- INSTALLED: (none new)
