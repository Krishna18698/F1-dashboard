# Screenshot harness

Renders the **real app** — not mockups — in a set of fixed scenarios, captures every screen and
state on desktop and mobile, and composes framed shots, a contact sheet, portfolio covers and a
portfolio card image. Also holds the end-to-end flow tests.

Output goes to `project/` at the repo root (gitignored).

## Run it

```bash
cd tools/screenshots
npm install                # once: Playwright, isolated from the app's own dependencies
npx playwright install chromium   # once, if Chromium isn't cached yet

npm run record             # first time (or to refresh data): capture while recording upstream responses
npm run shots              # re-capture from the recorded data — same data, same clock, every time
npm run frames             # frames, contact sheet, covers, featured card
npm test                   # end-to-end flows (must pass)
```

`node capture.mjs --only race,quali` re-captures just those scenarios.

## How it stays deterministic

- **Throwaway copy of the app.** Each scenario runs `next dev` on port 3100 from `.work/app`, a
  fresh copy of `app/`, `lib/`, `data/`, `public/` and the configs. No `.env*` file is copied, so
  there's no F1 token, no Supabase and no password. The copy is deleted when its server stops. Anything a scenario changes (the TEST replay
  switch in `lib/live/liveConfig.ts`, `devIndicators: false`) is changed in that copy only — the
  working tree is never touched.
- **Fixed clock.** `lib/preload.cjs` is `--require`d into the server and pins `Date` to the
  scenario's instant (it then runs in real time, so countdowns tick and cars move). The browser
  gets the same clock through an init script. Pages render in `Asia/Kolkata`, locale `en-IN`.
- **Recorded network.** Every server-side `fetch()` is served from `fixtures/`. `--record` fills it
  from the real APIs (Jolpica, F1's static archive, the news feeds, OpenF1); without it a request
  that was never recorded fails and is listed at the end of the run. Writes are never sent, and
  raw sockets out (F1's SignalR hub) are refused in both modes, so nothing depends on what F1
  happens to be running today. The browser can't reach the internet at all.

`fixtures/` is gitignored: it's third-party data (~25 MB), and `npm run record` rebuilds it.
If you re-record much later, move the `home` clock in `config.mjs` to match, or the page will
count down to a round the recorded standings already include.

## Scenarios (`config.mjs`)

| Scenario | Clock (UTC) | What it shows |
|---|---|---|
| `home` | 2026-09-23 14:30 | Race week: countdown to Baku, standings after Madrid, idle live section, replay journey, token form, Race Control sheet, loading skeleton |
| `race` | 2026-09-13 13:55 | Madrid race day, mid-race: live hero, tracker, timing board, telemetry, tyres |
| `quali` | 2026-09-12 14:45 | Madrid qualifying, Q3 |
| `offline` | 2026-09-23 14:30 | Every upstream down — the degraded page |

`race` and `quali` play the archived Madrid session through the app's own TEST replay path. In
the copy, that path's `replay: true` flag is flipped so the section is labelled the way the live
feed labelled it on the day (LIVE, not "Replay"). The data is the real session's; only the label
differs from what the TEST replay shows in development.

## What you get

```
project/
  screens/raw/{desktop,mobile}/*.png     screen-sized captures (1440×900 @2x, 390×700 @3x)
  screens/full/{desktop,mobile}/*.png    full-page captures
  screens/elements/*.png                 tight crops (map, board, section, hero) used by covers
  screens/framed/{desktop,mobile}/*.png  browser window / iPhone bezel with status bar
  contact-sheet.png                      everything on one page
  covers/cover-{1,2,3}.png|jpg           4:3 — 3200×2400 PNG, 1600×1200 JPG
  featured/pit-wall-card.png|jpg         portfolio card image (tracker + timing), reads at ~300px wide
  featured/pit-wall-website.png|jpg      portfolio card image (the website in a browser window)
  featured/card-preview*.png             each of those inside a Proof-of-Work style card
```

The site is light-only by design (`globals.css`: fixed light, no system dark), so there is no
dark variant to capture; forcing `prefers-color-scheme: dark` renders identically.

## When the UI changes

Selectors live in `capture.mjs` and `lib/browser.mjs` (headings by text, the board's
`ol > li.cursor-pointer` rows, the map's `Start/finish line` label). If a state fails, the run
names it and keeps going. `lib/app.mjs` throws if `next.config.ts`, `liveConfig.ts` or the
`f1live` route change shape in a way its patches no longer match.
