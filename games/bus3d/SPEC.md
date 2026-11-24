# Bendy Bus 3D: design brief (first playable slice)

The owner (non-technical, reviews by playing and from screenshots) is revamping Bendy Bus for a **6-year-old** inside the
"Let's Play!" app (read `/home/user/lets-play/CLAUDE.md`: hub, hub-mode protocol, design constraints, sound setting).
The new game lives in `games/bus3d/` and will replace `games/bus/` in the hub once the owner approves. Until then the
hub keeps pointing at `games/bus/`; preview builds switch the URL.

## The game in one paragraph
A cheerful low-poly 3D Singapore neighbourhood (HDB blocks with coloured stripes and void decks, a hawker centre, an
elevated MRT viaduct with a train gliding by, playground, trees, a park, a small shophouse row) where the child drives a
green bendy bus. Jobs: "Drive to the next stop!" A glowing ribbon on the road shows the way. At each stop passengers
board or alight, and the child answers a single-digit addition or subtraction question shown with **pictures to count**
(never bare equations to work out alone). A friendly teaching scene shows how to work it out. Each job earns cash
(coins, never taken away). Cash is spent at the bus depot on fuel, upgrades and customisation.

## Audience rules (binding)
- Pre-readers: every instruction is spoken (`speechSynthesis`), big tap targets (≥ 64 CSS px for driving controls,
  ≥ 56 elsewhere), minimal text, icons and pictures first.
- Gentle: no game over, no crashing damage, no timers, no penalties. Wrong answer → "Let's count together!" and the
  teaching scene, then try again. Cash is never lost. Fuel is gentle: the gauge drops slowly while driving; at low fuel
  the bus says "I'm getting hungry, let's go to the depot!" and the ribbon can point there; if it runs out, a friendly
  tow truck arrives and pulls the bus to the depot, where a free top-up gets it going (no cost, no lost progress).
- Maths: single digits; every number in a question and its answer is 0–10. The first job is very easy (e.g. 2 + 1),
  later ones build up. Hint after 2 wrong tries (glowing seats / counting fingers), teaching scene on a wrong answer
  and the first time each kind (adding, taking away) appears.
- Seats are a ten-frame: two rows of five seats (like the MRT game), so "7" reads as "5 and 2 more".
- Original characters/sounds/music; no real operator branding (no SBS/SMRT logos or liveries), generic bus look.
- Paper-cut storybook look carried into 3D: flat-shaded low-poly, warm saturated colours from a palette close to the
  hub's `P`, soft hemisphere + one directional light, no harsh black outlines, soft round blob shadows (no shadow maps
  needed), sky gradient. Should feel like the hub's world in 3D.

## Driving (must be trivially easy for a 6-year-old on an iPad)
- The bus follows a **road graph** (lanes snap; it cannot crash or leave the road; other traffic is optional/decorative
  and never blocks). Controls: one huge **GO pedal** (hold to drive, release to slow and stop) and, when approaching a
  junction, big **arrow choices** (left / straight / right) appear; if none is tapped the bus follows the ribbon. Also
  keyboard (Up/Space = go, Left/Right = choose turn) for testing.
- Stops: the bus pulls in automatically when it reaches a stop that is part of the current job.
- Chase camera behind and above the bus, smooth, never clipping into buildings; a small corner mini-map is optional.
- Landscape iPad first (1180×820, 1024×768); also phones sideways (844×390). In the hub it's a landscape-only game
  (the hub shows "Turn me sideways!" in portrait). Standalone portrait: show a turn-sideways hint.

## Tech (binding)
- No build step. `games/bus3d/index.html` loads `vendor/three.min.js` (three r149 classic UMD build, global `THREE`,
  MIT, vendored so it works offline) and then classic `<script>` files in order — NOT ES modules (they fail from
  file://). Everything shares one global namespace `window.BB`.
- Files and ownership (each builder edits only its files; shared contract below):
  - `index.html` — page shell, canvas, DOM overlay root `#ui`, script tags, base CSS.
  - `js/core.js` — `BB` namespace, config, tiny event bus (`BB.on(name, fn)`, `BB.emit(name, data)`), save/load
    (localStorage keys `bus3d.*`, every access in try/catch), audio (WebAudio synth effects + an original looping tune,
    `BB.sfx.<name>()`), speech `BB.say(text, {queue})`, and hub mode (see below).
  - `js/world.js` — builds the city into `BB.scene`: ground, roads with lane markings, kerbs, HDB blocks, landmarks,
    trees, bus stops (shelter + pole + sign with a picture, not words), the depot building; exposes `BB.world`.
  - `js/bus.js` — the bendy bus model (two carriages + accordion joint, articulated so it bends on turns, wheels spin,
    10 seat slots in two rows of five with world positions for passengers, doors that open), driving controller on the
    road graph, camera, fuel use; exposes `BB.bus`.
  - `js/jobs.js` — jobs, passengers (low-poly people walking on/off), the maths question, hints, the teaching scene,
    cash rewards; exposes `BB.jobs`.
  - `js/depot.js` — depot screen: refuel, upgrades, customisation; economy and saved progress; exposes `BB.depot`.
  - `js/ui.js` — HUD (cash with coin icon, fuel gauge as a picture, job card with stop picture, GO pedal, turn arrows,
    🔊/🎵, all-games button in hub mode, play clock chip in hub mode), toasts/celebrations; exposes `BB.ui`.
  - `js/main.js` — boot order, renderer, resize (DPR-aware, cap pixel ratio at 2), main loop
    (`BB.update(dt)` calls world/bus/jobs/ui updates), pause when hidden.
- Shared contract:
  - `BB.world = { scene, roads: { nodes:[{id,x,z}], edges:[{id,a,b,points:[{x,z}...], length}] }, stops:[{id, name,
    pic, edge, t, pos:{x,z}, heading, kerbSide}], depot:{ edge, t, pos, heading }, update(dt) }`.
  - `BB.bus = { group, pos, heading, speed, edge, t, fuel (0..1), seats:[{x,y,z} local], passengers (count 0..10),
    paint, setPaint(c), applyCustom(save), openDoors(), closeDoors(), stopAt(stop|depot, cb), choose(dir), go(on),
    update(dt) }`; emits `bus:arrived` {stop}, `bus:atJunction` {options}, `bus:fuelLow`, `bus:fuelEmpty`.
  - `BB.jobs = { current, start(), update(dt) }`; emits `job:new`, `job:stopDone` {correct, cash}, `job:done` {cash}.
  - `BB.depot = { open(), close(), cash, add(n), spend(n), save }`; emits `cash:changed`.
  - `BB.ui` listens to events and draws the HUD.
- Performance: must run smoothly on an older iPad (A10/A12). Low-poly merged geometry or InstancedMesh for repeated
  buildings/trees, MeshLambert/MeshToon or flat MeshStandard with few lights, no real-time shadow maps (blob shadows),
  pixel ratio ≤ 2, ~60 draw calls target, fog to limit distance. Pause the loop when hidden or held.
- Hub mode: identical protocol and behaviour to the current games (see CLAUDE.md "Hub ↔ game protocol"): `?hub=1`
  detection, `hello` at end of setup, time messages (clock chip, gentle bedtime: finish the current stop, goodnight
  moment, then `sleep` once; never start a new job after time is up), shared sound setting (`mute`/`music`, own 🔊/🎵
  post `{hub:'sound'}`), `hold` freezes everything, `pause` silences, all-games button top-left on the title/garage
  screen, stars message optional (cash or jobs done). Standalone works too (no hub features).
- Persistence: `bus3d.cash`, `bus3d.save` (upgrades, paint, stickers, fuel, jobs done). Works without storage.

## First slice scope
A compact neighbourhood (roughly a 3×3 block grid with a loop road and a few curves), ~5 bus stops each with a picture
landmark, the depot, jobs of 2–3 stops, at least 6 different questions growing from easy to harder, the teaching scene
for adding and for taking away, depot with: refuel; 2–3 upgrades (e.g. louder horn tune, brighter headlights, a third
"super sticker" slot — upgrades are fun, never needed); customisation: 6 paint colours, a few stickers, a hat/roof
decoration; and a short title/garage screen ("Tap to drive!"). Multiplayer is NOT in this slice (next phase: private
family rooms with a room code; keep `BB` state clean so a second bus can be added later).
