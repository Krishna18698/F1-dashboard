# Pit Wall — F1 Live Dashboard

An editorial (white & F1-red) Formula 1 dashboard built with **Next.js + TypeScript**:

- **Drivers' Championship** & **Constructors' Cup** standings — live from the API
- **Season calendar** (all rounds, highlights the next race)
- **Countdown** to the next race ("lights out in…")
- **Live driver tracking** during a session: a **track map** with moving car dots
  *and* a **live timing board** (positions, gaps/intervals, tyre compound)

## Data sources (free, no API key)

| Data | Source |
| --- | --- |
| Standings, calendar, next race | [Jolpica-F1](https://github.com/jolpica/jolpica-f1) (Ergast successor) — `lib/jolpica.ts` |
| Live positions, intervals, tyres, car GPS | [OpenF1](https://openf1.org/) — `lib/openf1.ts` |

Standings/calendar are fetched server-side and cached for 1h (ISR). Live data is
polled client-side from OpenF1 every few seconds while a session is running.

## Live vs. replay demo

Live tracking only has data while cars are on track. To let you **see it working any
time**, the app ships in **replay mode**: it replays a real past 2026 session against a
virtual clock, so the dots move and the board updates exactly as they would live.

Toggle in [`lib/liveConfig.ts`](lib/liveConfig.ts):

```ts
replay: { enabled: true, ... }   // demo: replays a real past session
replay: { enabled: false, ... }  // production: auto-detect a genuinely live session
```

With `enabled: false`, the dashboard auto-detects a live practice/qualifying/race and
shows it in real time; otherwise the live panel shows "next session in…".

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm start   # production
```

Deploy free on Vercel (`vercel`) or any Node host — no backend or database required.

Not affiliated with Formula 1. Data © their respective providers.
