# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Let's Play!": an all-in-one app for a ~6–7-year-old that combines three of the owner's games behind one launcher (the "hub") with ONE shared daily play-time limit set by a grown-up. Tablet first, also iPhone.

```
index.html               the hub: storybook launcher, shared play time, grown-up settings, shared sleep scene
games/bus/               Bendy Bus Counting Fun (index.html, game.js, style.css), canvas, landscape
games/grizzly/index.html Grizzly and the Lemmings (20 mini games), canvas 960x540, landscape
games/mrt/index.html     MRT Math Express, DOM, portrait-phone first
icons/, manifest.webmanifest, .nojekyll   hosting (icons drawn with the hub's art: node icons/make-icons.js)
sw.js                    the service worker that makes the Home Screen app work offline
```

No build step, no dependencies; everything is drawn and synthesised in code and works offline from `file://` (the bus game loads the Baloo 2 web font when online and falls back without it).

The owner reviews as a player, from screenshots and a link, not from code. Report in plain language and send screenshots of visible changes.

## Published copy

`main` is served by GitHub Pages from the repo root at https://hermannwwr-cmyk.github.io/letsplay/. Every push to `main` redeploys it within a minute or two. Cloud containers usually can't reach github.io (the proxy refuses it), so confirm a deploy with the "pages build and deployment" workflow run for that commit (GitHub MCP `actions_list`). `.nojekyll` turns off Jekyll.

The owner also has a private claude.ai Artifact copy titled "Let's Play!" (https://claude.ai/artifact/3HjW7hseEgPHX7MHT1sJvp). After a change, rebuild it in a scratch folder and republish it to that URL, with the hub as the page and the five `games/` files as supporting files at the same paths (the games' icons and manifests aren't needed). The host supplies the document skeleton, so strip it and the head tags from the hub:
```
sed -e '/^<!DOCTYPE html>/d' -e '/^<\/\?html/d' -e '/^<\/\?head>$/d' -e '/^<\/\?body>$/d' -e '/^<meta /d' -e '/^<link rel=/d' index.html > lets-play.html
```
Keep `<title>` and `<style>` near the top of `index.html` and each head tag on its own line, so this stays a line deletion. `sw.js` isn't needed in the Artifact (the hub only registers it on https in a top-level page, and a failed registration is ignored).

**Offline Home Screen app (`sw.js`):** a small versioned service worker, registered from `index.html` only when `location.protocol === 'https:'` and the hub is the top window (never from `file://`). On install it precaches the hub, the five game files and the icons/manifest (`CORE`; the games' own icons and manifests are `EXTRA`, skipped if missing), then `skipWaiting()`; on activate it deletes every other cache and `clients.claim()`s. Pages and code (`.html`, `.js`, `.css`, `.webmanifest`, navigations) are network-first with a cache fallback, fetched with `cache: 'no-cache'` so GitHub's `max-age=600` doesn't delay a push (a cheap 304 when unchanged). An error answer (404, 503) or a network slower than 4 s falls back to the cached copy (the fresh copy still lands in the cache), so a push shows up on the next launch with a connection. Redirected responses, or ones whose URL isn't the requested file (a Wi-Fi login page), are never cached. A redirect or a different page while online is treated like an error answer (the cached copy is used). A failed install removes the empty new cache; icons and images are cache-first; the bus game's Google Font is cached at runtime in `lets-play-fonts`. Lookups ignore the query string (games load as `index.html?hub=1`). **Bump `VERSION` in `sw.js` on every release** (any change to `index.html`, `games/` or `icons/`), and add new files to `CORE`: a missing `CORE` file makes the install fail and the old copy stays. To test it locally, serve a scratch copy and relax the https check to allow `localhost` (a secure context); Playwright's `context.setOffline(true)` after a first load simulates the offline relaunch.

**Previewing before going live:** a push to `main` goes public at once, so visible changes are shown to the owner first and pushed to `main` only after they say go. Show options as screenshots (before/after sheets at phone and iPad sizes), then build the chosen one into the preview Artifact "Let's Play! Preview" (https://claude.ai/artifact/TsjDv2hfXpHCB2ba5Lv4v5; same build, with `<title>` changed to match). Meanwhile commit the work to the `claude/dazzling-albattani-67ajm8` branch (Pages doesn't serve it), then fast-forward `main` to it on approval and republish the main Artifact.

## Where the games come from

The games are copies of the owner's standalone games, plus a small "hub mode" patch in each:
- Bus: the `Bendy-Bus-Game` repo's `gh-pages` branch (`index.html`, `game.js`, `style.css`).
- Grizzly: the `Grizzly-and-the-lemmings-game` repo's `index.html` (its CLAUDE.md documents the game in depth).
- MRT: the `MRT-GAME` repo's `index.html` (its CLAUDE.md and `tests/play.js` document and test it).

Hub mode only switches on with `?hub=1` inside an iframe (`const HUB = /[?&]hub=1\b/.test(location.search) && window.parent !== window`). Without it each copy behaves exactly like the original. To bring in a newer version of a game, re-apply that game's hub-mode code (everything guarded by `HUB`, plus the hub-only CSS) to the new file. The hub-mode code exists only here, not in the original repos. This repo starts from a single import commit, so diff `games/<game>` against the original game's file to see exactly what hub mode adds (the step-by-step history is on the `claude/dazzling-albattani-67ajm8` branch of `Bendy-Bus-Game`, where the app was first built; that branch is no longer updated).

## Hub ↔ game protocol (postMessage, always to `'*'`)

In `file://` the frames have opaque origins, so never touch `parent.document` and don't rely on storage shared between hub and game. Ignore messages that aren't objects with a `hub` string; games also check `e.source === window.parent`, and the hub checks that messages come from the current frame.

| from → to | message | when |
|---|---|---|
| game → hub | `{hub:'hello', game}` | script start; the hub closes a frame that hasn't said hello within ~6 s |
| game → hub | `{hub:'exit'}` | child taps the "all games" button |
| game → hub | `{hub:'sleep'}` | the game's own gentle bedtime ending has finished; the hub treats it as the end of the day |
| game → hub | `{hub:'stars', count}` | optional, for the stars shown on the launcher |
| hub → game | `{hub:'time', limit, left, used, share}` | about every second and on hello; `left` is null and `share` 0 when the limit is off |
| hub → game | `{hub:'hold', on}` | `on:true` when the "turn me sideways" card covers a running game, `on:false` when it goes. The game freezes (no updates, timers or speech, sound suspended) and then carries on exactly where it was. Bus re-says the line that was cut off, or the question on screen. MRT is never covered and ignores it. |
| hub → game | `{hub:'pause'}` | right before the frame is removed |

In hub mode every game: doesn't count time or touch its own play-time storage; hides its own grown-up gear/gate/settings; shows the shared **all-games button** top-left on its start screen (a 64px cream paper circle, at least 56 CSS px on phones, fill `#fff6e0`, rim `#d9b57f`, with a 2×2 grid of rounded cards `#f26b5b` `#f5b83d` / `#5cb85c` `#4fa3e0`, bobbing gently); shows the shared clock chip look (cream pill, drawn clock, m:ss, orange with a moon in the last minute); runs its own gentle bedtime ending and then posts `sleep` once; never starts a new round once time is up; and paints the letterbox around its canvas as sky and grass (Grizzly, Bus).

- **Grizzly:** the menu gear spot becomes the all-games button (grown by `hubExitR()` on small screens, with the "N min" chip moved along); its bedtime ending posts `sleep` where it used to `go('sleep')`: after the next end-of-level or end-of-game overlay (shown for 3 s), or at the latest `BEDTIME_GRACE` (150 s) after zero; the continuous action games (no rounds to finish) say goodnight at a calm moment about `CONT_GRACE` (35 s) after zero, never mid-jump.
- **MRT:** `#homeClock` becomes the all-games button (inline SVG). Its "2 more stops" flow starts at 60 s left, so its bedtime ride usually ends before zero; it posts `sleep` ~7 s into the sleepy end screen. At zero on the start or normal end screen it posts `sleep` at once.
- **Bus:** it had no limiter; hub mode adds the clock chip, a last-minute warning (between stops, or as a stop's question starts if it hasn't been given; never during counting), an evening-to-night sky following `share`, and a goodnight moment (the bus parks, lights off, "Goodnight, bus!") after the stop in progress is answered.

## The hub (`index.html`)

One canvas, in the Grizzly paper-cut art style (its art kit, palette and the embedded Fredoka font were copied in).
- **Finding your way** (one IIFE, about 2,900 lines): `GAMES` (url, name, spoken name, colour per key) and `ORDER` near the top, then `playTime` with `DEFAULT_LIMIT`, `LIMIT_CHOICES` and `FORCE_SLEEP_AFTER`; the art kit and the heroes (`drawBear`, `drawLemmingAt`, `drawBusHero`, `drawTrainHero`); `layout()` (landscape and portrait placement of the places, path and props); `SKY` and the tints; one `draw<Game>Place()` per place; then the frame lifecycle (`openGame`, `sendTime`, `closeGame`, `updateTransition`, `goSleep`, `LANDSCAPE_ONLY`, `showRotate`/`showOver`/`checkRotate`, `reloadPlayTime`). A fourth game would need a `GAMES`/`ORDER` entry, a place in `layout()`, a `draw…Place()`, a loading scene, and hub mode in the game itself.
- **Launcher:** a panoramic storybook world with three places on paper islands joined by a path: the bendy bus at its stop, Grizzly and the lemmings, the MRT train on a viaduct. Places idle-animate and take turns doing a "look at me" act. A tap pops (pointerdown), then on pointerup squashes, plays a sound, speaks the name, throws confetti, zooms in and closes an iris in that game's colour with its hero bouncing while the frame loads. Landscape: places side by side; portrait: zig-zag down the hills. Arrow keys / Enter / 1–3 / M work too.
- **Turn sideways:** Grizzly and Bus are landscape games. On a portrait screen the hub shows a "Turn me sideways!" card instead, opens the game when the device turns, and covers a running game (not counting time) if it's turned back upright, also while the game is still loading or being revealed (the hold is sent again when the game says hello). MRT opens in any orientation. On a tablet-sized screen (`min(screen.width, screen.height) >= 700`) whose window clearly doesn't fill the screen either way round (`narrowTabletWindow()`: iPad Split View, Slide Over, Stage Manager) the card also offers a small "Play anyway" button (`playAnyway()`, sets `state.anyway` so that game isn't covered again until it closes); a full-screen iPad held upright and phones never show it.
- **Game frame:** Bus and Grizzly get the whole screen (they letterbox their own canvas, with buttons clear of the notch). MRT, edge-to-edge DOM, gets an inset frame (`iframe.game.inset`, inset by the hub's safe areas `--sat` etc., since WebKit doesn't pass them into frames), so it isn't under the notch or home indicator; `paintFrameBg()` paints the strips in MRT's own page colours (start-screen sky gradient with the viaduct deck under it, its night sky on the sleepy end screen, `--bg` otherwise), reading MRT's `body[data-screen]` / `.night` in a try/catch when the frame is same-origin and using the start-screen colours from `file://`. On the start screen the sky is laid over the frame's area so it carries on into the side strips, the top strip is MRT's exact top colour and its sun glow continues across the seam, and `#frameDock` / `#frameDeck` copy MRT's `.start-dock` background (flats, trees, viaduct) into the strip on the dock's side and its deck colour under it (read every 400 ms). While a game fills the screen (`gameShown()`), the hub's draw loop and music scheduling stop and its canvas and painted layers are freed (`sleepLoop()`); `wakeLoop()` restores them (closing, the sideways card), lays out again if the window changed meanwhile, and the painted layers are rebuilt behind the closed iris (`warmLayers()`). `resize()` does nothing when the size, DPR and safe areas haven't changed; clouds, birds and fireflies keep their own random numbers so a resize re-places rather than reshuffles them.
- **Play time:** storage `hub-limit` (minutes, default 15; Off/10/15/20/30) and `hub-play` = `{day:'Y-M-D' (no zero padding), used: seconds, extra: minutes}`. Counts whole seconds only while a game frame is showing (after hello, no transition, no modal, no sideways card, page visible), and never past the allowance. Re-reads on `storage` events and when the page becomes visible. The top bar is small paper pieces: a borderless cog (grown-ups) top-left, a cream time pill beside it (a sun in a ring that empties and turns into a moon; orange in the last minute; tapping it speaks the minutes left, at most every 3 s of real time, and never opens settings). Minutes left are shown and spoken the same way everywhere (`fmtLeft`): whole minutes rounded up, and "under 1 min" in the last minute (pill, speech and settings), and one music|sound capsule hanging on short strings top-right (no strings below 420 px height). Positions come from `barGeom()`, clouds fade out behind the bar (`cloudClear()`), and the portrait title sits below the bar; the sky follows `share()` from dawn to night, with warm window and lamp light drawn after the night tint.
- **Bedtime:** at zero the game finishes the turn and posts `sleep` (fallback: force-sleep 3 minutes past zero). A `sleep` that arrives while the frame is already closing because the child chose to leave is ignored (the closing still goes to bed if the time is up). The shared sleep scene shows everyone asleep with a lullaby (drawn at about 30 fps; on upright screens the "Time to sleep!" card moves up and shrinks to stay above the sleeping train's station); places can't be opened; it survives reloads. Adding time in the settings wakes everyone. A new day also ends the sleep scene, even if the screen stayed on all night (checked every 250 ms): that wake is silent (`wake(true)`: no sound, no speech, and the music stays off until the next real tap or key, `musicHold`), and so is a wake from a `storage` or visibility change; a tap on a place wakes everyone with "Good morning!".
- **Timing and cost:** animation time (`time`) uses `dt` capped at 0.1 s; transitions and other waits use real time (capped at 0.25 s per frame), and the pill's pause and the watchdogs use `performance.now()`. The no-hello watchdog is paused while the page is hidden. Glowing windows (the town, the bus, the train) are painted once with their glow into cached sprites (`glowSprite()`) and drawn with `globalAlpha`; they and the painted layers are built after a layout and behind the closed iris (`warmLayers()`), never mid-frame; the evening and night multiply tints are folded into a single fill.
- **Grown-ups:** the gear (top left, launcher and sleep scene only) → a 6–9 × 6–9 times-table check on a keypad (a wrong answer shakes and gives a new sum with a different answer) → limit, today's use, "+5 min today", "Start today again", Done.
- **Other storage:** `hub-stars`, `hub-music`, `hub-mute`. Every access in try/catch; works without storage.
- **iOS audio:** unlocks on pointerup/touchend/click/keydown and sets `navigator.audioSession.type = 'playback'`; buttons fire on pointerup. Hub music stops while a game is open; on leaving a game the hub posts `pause`, cancels speech and removes the frame. `say()` and becoming visible call `speechSynthesis.resume()` (iOS can leave speech paused), and music is only ducked for up to 15 s after the hub last spoke, in case `speaking` sticks.
- **Test hook** `window.__hub`: `open(key, {anyway})` (returns `'rotate'` when the sideways card shows), `exit()`, `state()`, `playTime` (`left()`, `used()`, `share()`, `limit`), `modal` (with `answer`), `layout()`, `buttons()`, `setUrl(key, url)` (point a place at a fake game), `closeRotate()`, `sky(phase)`.

## Testing

No test suite in this repo. Verify with headless Playwright (`require('playwright')` is preinstalled in cloud sessions), serving the folder with `python3 -m http.server` or loading `file://`. Useful sizes: iPad 1180×820, 1024×768, 820×1180; iPhone 390×844, 844×390, 375×667.
- Seed bedtime states with `page.addInitScript(() => { localStorage.setItem('hub-limit','20'); localStorage.setItem('hub-play', JSON.stringify({day, used: 1130, extra: 0})) })`; `hub-limit` `'0'` turns the limit off.
- The MRT suite (`node tests/play.js` in the MRT-GAME repo) still runs against a copy of `games/mrt/index.html` placed next to that `tests/` folder (with its `icons/` and manifest), proving standalone behaviour is unchanged.
- Hold: open Bus or Grizzly landscape, then `page.setViewportSize` to portrait; while covered, `__bendyBus.game.dist`/`time` and Grizzly's canvas and `__game.music.step` must not change, and nothing is spoken. Bus's flow timers go through `later()`/`cancelLater()` so a hold can freeze them; use those for new timers in the bus game.
- Each game's own test hooks still work inside the frame (`frame.evaluate`): Grizzly `window.__game`, Bus `window.__bendyBus`.
- Never commit test hooks or shortened timers.

## Future work

- A heartbeat from the games (`{hub:'alive'}` about once a second, and `hello` sent at the end of setup), so the hub can show its own way back if a game hangs after saying hello. It needs changes in all three games, so it isn't done yet.

## Design constraints

Gentle for young kids: no game over, no timers except the grown-up's daily limit, which never cuts a child off mid-turn. Pre-readers: big targets, minimal text, spoken names. Touch first. Original characters, tunes and sounds; no copied TV-cartoon looks, real MRT/bus chimes or operator branding. Paper-cut storybook look: flat shapes, a darker crescent on the lower right, rims in a deeper tone, no black outlines.
