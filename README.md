# Pit Wall — F1 Live Dashboard

*For the fans, from a fan.*

An editorial (white & F1-red) Formula 1 dashboard built with **Next.js + TypeScript**.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

## Features

- **Live driver tracking** — a track map with moving car dots **and** a live timing board,
  session-aware: intervals for races, best-lap times for practice/qualifying. Shows only when
  a session is actually on track; minimizes to a slim bar otherwise.
- **Drivers' & Constructors' Championships** — auto-updating standings.
- **Season calendar** — a strip of the current round (black) + the next five.
- **Next-session countdown** on the race card — names the next session (FP1 / Sprint Qualifying
  / Sprint / Qualifying / Race) and shows the weekend schedule chips + circuit lap record.
- **Rolling results ticker** — the latest session's full classification scrolls across the card.
- **Paddock Intel** — latest F1 news pulled from public RSS (title, summary, source, date).

## Data sources

| Data | Source | Key needed? |
| --- | --- | --- |
| Standings, calendar, next race/sessions | [Jolpica-F1](https://github.com/jolpica/jolpica-f1) (Ergast successor) | No |
| Paddock Intel news | Motorsport / Autosport / Formula1.com RSS | No |
| **Live timing + map (real-time)** | F1 official SignalR feed (`livetiming.formula1.com/signalrcore`) | **F1 TV token** |
| Live timing (delayed, free) | F1 official **static** feed (`livetiming.formula1.com/static`) | No |

Standings/calendar/news are fetched server-side and cached. Live data is proxied through the
app's own API routes (`/api/f1live`, `/api/f1results`) — no secrets ever reach the browser.

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
4. Restart the dev server. The map + board go live during any session.
   > The token expires after a few days — re-grab it the same way when live stops working.
   > Timing is data only (no video); it doesn't use a video-stream slot, and your credentials
   > stay on your machine.

**Option B — free:** leave `F1_TV_TOKEN` blank. The app uses F1's free **static** feed, which
publishes with a delay, and minimizes to "no live session" until data is available.

See [`.env.example`](.env.example) for all variables.

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start   # production
```

## Architecture

```
app/
  page.tsx                      # dashboard composition (server component, ISR)
  api/
    f1live/route.ts             # live map + timing (relay if token, else static feed)
    f1results/route.ts          # latest-session classification (for the ticker)
    live/[endpoint]/route.ts    # OpenF1 proxy (optional alternative source)
  components/                   # Hero, Calendar, standings, Paddock Intel, live/*, ticker
lib/
  jolpica.ts                    # standings / calendar / weekend sessions
  f1Relay.ts                    # server-only SignalR client (F1 TV token) + state reducer
  f1feed.ts                     # F1 free static-feed engine (parse / decode / reduce)
  news.ts                       # Paddock Intel RSS
  format.ts, geo.ts, lapRecords.ts, *Config.ts
```

## Notes

- Built with the latest Next.js (App Router) + Tailwind v4. No database.
- Uses F1's undocumented live-timing feed (the same one FastF1 / MultiViewer use) — free and
  fine for **personal** use, but unofficial and not for commercial/public deployment.
- Not affiliated with Formula 1. Data © their respective providers.
