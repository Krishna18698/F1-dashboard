# Pit Wall — F1 Live Dashboard

*For the fans, from a fan.*

An editorial (white & F1-red) Formula 1 dashboard built with **Next.js + TypeScript**.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## Features

### Live tracking
- **Driver Tracker** — a track map with moving car dots, drawn in F1's own coordinate system
  (via MultiViewer's circuit outlines) so cars sit exactly on the racing line. Playback runs
  ~20s behind live and interpolates through the real GPS samples on a Catmull-Rom spline
  (smooth through corners, no prediction/guessing), with per-car exponential smoothing to
  filter the feed's raw GPS jitter — steady pace, no surge/slow.
- **Track-status tint** — the map glows yellow / Safety-Car orange / red with a status chip
  whenever the flag isn't green, easing back to normal on Track Clear.
- **Click-to-follow + telemetry** — click any driver (on the map or the timing board) to
  highlight them and dim the rest; a telemetry card shows live **speed, gear, throttle and
  RPM** from the car's own data channel.
- **Pit lane & DNF handling** — cars vanish from the map while in the pits and reappear on
  exit; retired/crashed drivers get a **DNF** chip and drop off the map instead of sitting
  parked on track.
- **Corner numbers**, drawn just outside the track line.
- **Driver Live Tracker** — a clean running order: position, driver, gap to leader / interval
  (race) or best lap (quali/practice).
- **Tyre Tracker** — the full strategy board: gained/lost vs the starting grid (▲▼), gap /
  interval / last lap, a fastest-lap footer, and a per-driver stint bar across the race's lap
  axis with a tyre-compound token (and laps run) at the end of every stint.
- **Race Control** — a right-side panel that pops the latest messages on anything new
  (flags, Safety Car/VSC, penalties, investigations) and opens into the full timestamped
  history for the session, with a live track-status banner.
- **Live championship projection** — instantly updated points right after a Sprint or Race,
  before Jolpica's official standings catch up.
- Session-aware throughout (race vs. practice/qualifying) and shown **only** while a session
  is actually on track — minimizes to a slim bar otherwise, and knows the difference between
  "the race is over" and "the race is red-flagged" (it never flips early on a live guess).

### Season & standings
- **Drivers' & Constructors' Championships** — auto-updating standings with **movement arrows**
  (▲▼ vs. the previous round) and points gained.
- **Season calendar** — the last completed round (with its **🏆 winner**) + the upcoming
  weekend (badged **NEXT** before it starts, **CURRENT** once it's underway) + the next few
  rounds.
- **Weekend schedule** — every session of the current round in your local time, ticked off as
  they finish.
- **Next-session countdown** on the hero card, with the circuit's lap record.
- **Rolling results ticker** — the latest session's classification scrolls across the hero
  card, and auto-hides 24h after the session ends.

### Everything else
- **Paddock Intel** — latest F1 news pulled from public RSS.
- **F1 TV token banner** — warns (with a live countdown) before your token expires, and again
  once it has, so live tracking never goes dark silently.
- **Loading skeletons** — a full-page shimmer skeleton mirrors the real layout while the
  server fetches, so there's never a blank tab or a layout jump.
- Polling pauses when the tab is hidden and backs off when nothing is live, to stay well
  inside free hosting limits.

## Data sources

| Data | Source | Key needed? |
| --- | --- | --- |
| Standings, calendar, next race/sessions | [Jolpica-F1](https://github.com/jolpica/jolpica-f1) (Ergast successor) | No |
| Circuit outlines (for the track map + corner numbers) | [MultiViewer](https://multiviewer.app/) circuits API | No |
| Paddock Intel news | Motorsport / Autosport / Formula1.com RSS | No |
| **Live timing, map, telemetry, race control (real-time)** | F1 official SignalR feed (`livetiming.formula1.com/signalrcore`) — Position, TimingData, CarData, TrackStatus, RaceControlMessages, LapCount | **F1 TV token** |
| Live timing, map, race control (delayed, free) | F1 official **static** feed (`livetiming.formula1.com/static`) — same topics, no auth | No |

Standings/calendar/news are fetched server-side and cached. Live data is proxied through the
app's own API routes (`/api/f1live`, `/api/f1results`, `/api/racecontrol`, `/api/championship`,
`/api/circuit`) — no secrets ever reach the browser. `/api/f1token` reports only whether a
token is present and when it expires, never the token itself.

## Live tracking setup

Live tracking needs a data source for the running session:

**Option A — real-time (recommended if you have F1 TV):**
1. Log in at [f1tv.formula1.com](https://f1tv.formula1.com/).
2. DevTools → Application → Cookies → copy the `login-session` cookie's `subscriptionToken`
   (the `eyJ…` JWT).
3. Put it in `.env.local`:
   ```
   F1_TV_TOKEN=eyJ...your-token...
   ```
4. Restart the dev server. The map, board, tyres, telemetry and race control all go live
   during any session.
   > The token lasts a few days (covers a race weekend) — the in-app banner counts down and
   > warns you before it expires. Re-grab it the same way when live tracking stops. Timing is
   > data only (no video); it doesn't use a video-stream slot, and your credentials stay on
   > your machine (never logged, never sent to the browser).

**Option B — free:** leave `F1_TV_TOKEN` blank. The app uses F1's free **static** feed —
same map, board, tyres, race control and DNF/pit handling, just delayed and without the
per-car telemetry card. The Live Tracking header shows a small **FREE FEED** badge in this
mode. Minimizes to "no live session" until a session is actually on track.

See [`.env.example`](.env.example) for all variables.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start   # production
```

## Deploy

See [DEPLOY.md](DEPLOY.md) for deploying your own private instance to Vercel's free tier
(with an optional `DASHBOARD_PASSWORD` HTTP Basic gate).

## Architecture

```
app/
  page.tsx                      # dashboard composition (server component, force-dynamic)
  loading.tsx                   # route-level shimmer skeleton
  manifest.ts                   # PWA manifest
  api/
    f1live/route.ts             # live map + timing (relay if token, else static feed; incremental frames)
    f1results/route.ts          # latest-session classification (for the ticker)
    racecontrol/route.ts        # race control messages + track status
    championship/route.ts       # live championship projection
    circuit/route.ts            # MultiViewer circuit outline proxy
    f1token/route.ts            # token presence/expiry (never the token itself)
    livestatus/route.ts         # is a session live right now + which one
    live/[endpoint]/route.ts    # OpenF1 proxy (optional alternative source)
  components/
    Hero.tsx, Calendar.tsx, WeekendSchedule.tsx, SessionSchedule.tsx,
    DriversTable.tsx, ConstructorsTable.tsx, Movement.tsx (standings arrows),
    SessionResults.tsx (ticker), PaddockIntel.tsx, TokenBanner.tsx
    live/
      LiveSection.tsx            # composes the whole live-tracking section
      TrackMap.tsx               # track map: playback, interpolation, tint, telemetry select
      TimingBoard.tsx            # Driver Live Tracker
      TyreTracker.tsx            # strategy board (stints, gained/lost, fastest lap)
      TelemetryCard.tsx          # speed/gear/throttle/RPM for the followed driver
      RaceControl.tsx            # toast + drawer
      framesStore.ts             # position buffer, decoupled from React state
lib/
  jolpica.ts                     # standings / calendar / weekend sessions / winners
  f1Relay.ts                     # server-only SignalR client (F1 TV token) + state reducer
  f1feed.ts                      # F1 free static-feed engine (parse / decode / reduce)
  f1Token.ts                     # token expiry decoding (server-only)
  trackStatus.ts                 # shared TrackStatus code → label/colour
  news.ts                        # Paddock Intel RSS
  format.ts, geo.ts, lapRecords.ts, teamColors.ts, now.ts, *Config.ts
```

## Notes

- Built with the latest Next.js (App Router) + Tailwind v4. No database.
- Uses F1's undocumented live-timing feed (the same one FastF1 / MultiViewer use) — free and
  fine for **personal** use, but unofficial and not for commercial/public deployment.
- Not affiliated with Formula 1. Data © their respective providers.
