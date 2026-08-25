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
  (race) or best lap (quali/practice). During qualifying it shows which segment is live
  (Q1/Q2/Q3) with a live-ticking countdown for that segment, and shades the elimination zone
  red for drivers currently on the wrong side of the cut.
- **Tyre Tracker** *(race only)* — the full strategy board: gained/lost vs the starting grid
  (▲▼), gap / interval / last lap, a fastest-lap footer, and a per-driver stint bar across the
  race's lap axis with a tyre-compound token (and laps run) at the end of every stint.
- **Tyre Allocation** *(qualifying only)* — how many fresh sets of each dry compound
  (Soft/Medium/Hard) every driver has left from the weekend's tyre allocation, in a compact
  two-column layout covering the whole field (including drivers already knocked out in an
  earlier segment). Computed from real usage — the feed's per-stint "new tyre" flag, summed
  across Practice 1–3 and Qualifying — against the standard 13-set allocation (8 Soft / 3
  Medium / 2 Hard).
- **Race Control** — a right-side panel that pops the latest messages on anything new
  (flags, Safety Car/VSC, penalties, investigations) and opens into the full timestamped
  history for the session, with a live track-status banner.
- **Live championship projection** — instantly updated points right after a Sprint or Race,
  before Jolpica's official standings catch up.
- **Bring your own F1 TV token** — any visitor can add their own token for real-time tracking
  instead of relying on the site owner's. Kept only in their browser (never on the server),
  sent as a request header on their own polls, and never logged or persisted — see
  [Live tracking setup](#live-tracking-setup).
- Session-aware throughout (race vs. practice/qualifying) and knows the difference between
  "the race is over" and "the race is red-flagged" (it never flips early on a live guess).
  When nothing is genuinely live, it falls back to replaying the most recently completed
  session — clearly badged **REPLAY**, never presented as live.

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
| **Timing board, tyres, sectors, race control, session status — real-time** | F1 live-timing WebSocket (`livetiming.formula1.com/signalrcore`) | **No.** F1 serves these to an anonymous subscribe |
| **Car positions (the map) + telemetry** | The same socket — `Position.z` and `CarData.z` | **F1 TV token** (the site's, or a visitor's own) |
| Replay, and the fallback when the socket is closed | F1 **static** archive (`livetiming.formula1.com/static`) — published hours after a session | No |
| Finished-round classification, kept after the socket closes | Supabase (optional) | Supabase URL + service-role key |

Only **two** topics are actually gated, measured by an A-B subscribe against the same session:
`Position.z` and `CarData.z`. Everything else is byte-for-byte identical with or without a
token, which is why a tokenless deployment still gets a real-time board — it just has no map.
(The live championship projection appears to be gated too; see the note in
`app/api/championship/route.ts`.)

Standings/calendar/news are fetched server-side and cached. Live data is proxied through the
app's own API routes (`/api/f1live`, `/api/f1results`, `/api/racecontrol`, `/api/championship`,
`/api/circuit`) — no secrets ever reach the browser. `/api/f1token` reports only whether the
site's own token is present and when it expires, never the token itself. A visitor's own
token never touches any of that — see Option C below.

## Live tracking setup

Live tracking needs a data source for the running session — in priority order, the app uses
whichever of these is available:

**Option A — a visitor brings their own F1 TV token (no setup for the site owner):**
Anyone viewing the site can add their own token via the card shown in the Live Tracking
section. It's saved only in their browser (`localStorage`), sent as a request header (never
a URL) on their own polls, and used server-side for exactly that one request — never logged,
never written to disk, never shared with any other visitor. This takes priority over the
site's own token when present, so a visitor always gets their own real-time view. See the
in-app card for how to grab a token (same steps as Option B below, just pasted into the page
instead of `.env.local`).

**Option B — the site owner's own token (recommended for your own deployment):**
1. Log in at [f1tv.formula1.com](https://f1tv.formula1.com/).
2. DevTools → Application → Cookies → copy the `login-session` cookie's `subscriptionToken`
   (the `eyJ…` JWT).
3. Put it in `.env.local`:
   ```
   F1_TV_TOKEN=eyJ...your-token...
   ```
4. Restart the dev server. The map, board, tyres, telemetry and race control all go live
   during any session, for every visitor who hasn't added their own token.
   > The token lasts a few days (covers a race weekend) — the in-app banner counts down and
   > warns you before it expires. Re-grab it the same way when live tracking stops. Timing is
   > data only (no video); it doesn't use a video-stream slot, and your credentials stay on
   > your machine (never logged, never sent to the browser).

**Option C — no token at all:** the app still connects to F1's live socket, anonymously. You
get the timing board, tyres, sectors, race control, session status and results **in real
time** — everything except the car dots and the telemetry card, which are the only two gated
topics. The Live Tracking header shows a **FREE FEED** badge and the map area explains what a
token would add, rather than sitting empty.

This is a real improvement over the old behaviour, which fell back to F1's static archive:
that archive publishes *hours* after a session (the 2026 Dutch GP race was still
`ArchiveStatus: "Generating"` 42 minutes after the flag), so a tokenless deployment used to
show nothing useful during a live race. The archive is now only used for **REPLAY** — an
explicit view a visitor chooses, always badged as such and never presented as live.

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

Everything under `lib/` is organised by **mode first, then source** — because a file named for
its implementation (`f1Relay`, `f1feed`) never told you which mode it served, and one of them
quietly served both.

```
app/
  page.tsx                    # dashboard composition (server component, force-dynamic)
  loading.tsx                 # route-level shimmer skeleton
  api/
    f1live/route.ts           # live map + timing; the mode priority chain lives here
    f1results/route.ts        # latest classification — socket, then snapshot, then archive
    racecontrol/route.ts      # race control messages + track status
    championship/route.ts     # live championship projection
    circuit/route.ts          # MultiViewer circuit outline proxy
    f1token/route.ts          # token presence/expiry (never the token itself)
    livestatus/route.ts       # is a session live right now, and which one
    cron/recheck/route.ts     # daily stewards re-check (Vercel Cron, secret-guarded)
  components/
    Hero.tsx, Calendar.tsx, WeekendSchedule.tsx, SessionSchedule.tsx,
    DriversTable.tsx, ConstructorsTable.tsx, Movement.tsx, SessionResults.tsx,
    PaddockIntel.tsx, TokenBanner.tsx
    live/
      LiveSection.tsx         # composes the live section; server-seeded so idle paints instantly
      TrackMap.tsx            # playback, interpolation, tint, driver select
      TimingBoard.tsx         # Driver Live Tracker
      TyreTracker.tsx         # strategy board (stints, gained/lost, fastest lap)
      TelemetryCard.tsx       # speed/gear/throttle/RPM for the followed driver
      RaceControl.tsx         # toast + drawer, revealed in step with the map
      MyTokenCard.tsx         # bring-your-own-token entry/removal
      liveTypes.ts            # shape of the rendered session state
      framesStore.ts          # position buffer, decoupled from React state
lib/
  live/
    liveSocket.ts             # LIVE · F1's live-timing WebSocket. One shared connection,
                              #   opened only inside a schedule window; plus a fresh,
                              #   isolated, auto-torn-down session per visitor token
    liveArchive.ts            # LIVE · static archive, fallback tier
    liveTest.ts               # LIVE TEST · archive on a virtual clock, for development
    liveStatus.ts             # LIVE · socket -> archive -> schedule status chain
    liveConfig.ts             # LIVE · mode, base URL, test-replay switch
  replay/
    replayArchive.ts          # REPLAY · static archive, only via explicit ?view=replay
  archive/
    archiveParser.ts          # private core: parse/decode/reduce. No mode of its own —
                              #   both liveArchive and replayArchive read through it
  store/
    roundResults.ts           # durable finished-round snapshot (Supabase; optional)
  sessionWindows.ts           # every timing constant more than one file needs
  timingTypes.ts              # timing data shapes (pure types, no network)
  jolpica.ts                  # standings / calendar / weekend sessions / winners
  championshipPoints.ts       # 2026 points tables + applying a session to standings
  f1Token.ts, tokenExpiry.ts, visitorToken.ts, trackStatus.ts, news.ts,
  format.ts, geo.ts, lapRecords.ts, teamColors.ts, now.ts
supabase/
  schema.sql                  # one table; run once in the SQL editor
vercel.json                   # the daily cron registration
```

### When the socket is open

The WebSocket is expensive to open (negotiate + handshake + subscribe), and outside a session
it can only ever report "nothing is live" — which the schedule already knows for free. So it
opens **5 minutes before** a scheduled session and closes **5 minutes after**, and midweek it
is never opened at all. The window comes from Jolpica, then F1's own `Index.json` if that
fails, then fails **open** — a schedule we could not fetch must never be the reason a live
session looks dead. An established connection is never dropped mid-session.

### How results and points survive after the flag

The classification stops changing at the chequered flag — measured against the Dutch GP
archive, the top five are byte-identical from lap 70 to the end. But Jolpica takes hours to
publish the official result (~21 h for that race), which used to leave the standings showing
**pre-race** totals in between. Four sources cover the gap, fastest first:

1. **Live projection** — F1's own `ChampionshipPrediction`, while the socket still holds the
   session. Applied in the standings tables.
2. **Computed** — official totals plus the classification the app already has. Needs no token,
   and is what a tokenless deployment uses.
3. **Snapshot** — the finishing order written to Supabase at the flag, so a serverless cold
   start hours later does not have to re-read a 7.5 MB archive to fill the ticker. A daily
   cron re-checks it once per round for stewards' penalties.
4. **Jolpica** — official, and supersedes all of the above once published.

Without Supabase configured every one of those still works except step 3; the app simply falls
back to socket → archive → Jolpica as before.

## Notes

- Built with the latest Next.js (App Router) + Tailwind v4. The only database is an
  optional single-table Supabase project for finished-round results; everything else is
  fetched and cached at the fetch layer.
- Uses F1's undocumented live-timing feed (the same one FastF1 / MultiViewer use) — free and
  fine for **personal** use, but unofficial and not for commercial/public deployment.
- Not affiliated with Formula 1. Data © their respective providers.
