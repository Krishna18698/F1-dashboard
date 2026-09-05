# Deploy your private dashboard for free (Vercel)

Get your dashboard live at a URL you can open from anywhere — **free, no card, only you**.

## Why Vercel

Everything runs inside Vercel's free **Hobby** tier — no credit card, one daily cron, one
function region. A password gate (`DASHBOARD_PASSWORD`) keeps it private to you.

The connection to F1 is a WebSocket held per server process, but it is only opened inside a
window around a scheduled session (5 min before → 5 min after) and never midweek, so a
serverless deployment is not paying to keep anything alive between race weekends.

> Personal/non-commercial use only — that's exactly what the free Hobby tier is for, and
> you must never expose your F1 TV token publicly (the password gate prevents that).

## One-time setup (~5 min)

1. Go to **[vercel.com](https://vercel.com)** → **Sign up with GitHub** (free, no card).
2. **Add New… → Project** → import **`Krishna18698/F1-dashboard`**.
3. Before deploying, open **Environment Variables** and add:

   | Name | Required | Value |
   | --- | --- | --- |
   | `DASHBOARD_PASSWORD` | strongly recommended | any password you choose |
   | `F1_TV_TOKEN` | optional | your F1 TV `subscriptionToken` (the `eyJ…` JWT). Without it you still get a real-time timing board — just no map or telemetry |
   | `SUPABASE_URL` | optional | `https://<ref>.supabase.co` — see below |
   | `SUPABASE_SERVICE_ROLE_KEY` | optional | the **service_role** key, not `anon` |
   | `CRON_SECRET` | with Supabase | any long random string (`openssl rand -hex 32`) |
   | `OPENF1_API_KEY` | rarely | only if you want the OpenF1 fallback during a live session — its free tier returns 401 for every endpoint, past sessions included, while any F1 session is running |

4. Click **Deploy**. In ~1 min you get a URL like `https://f1-dashboard-xxx.vercel.app`.

5. **Set the function region.** Settings → Functions → Region. Pick the one nearest *you*,
   not nearest your database — then put Supabase in the same region. Vercel defaults to
   `iad1` (US East), and if you are elsewhere every dynamic page load pays a round trip to
   Virginia before any work starts. Moving a Mumbai-based deployment from `iad1` to `bom1`
   took typical page loads from ~0.5 s to ~0.2 s.
5. Open it from your phone anywhere → browser asks for login → **username: anything**,
   **password: your `DASHBOARD_PASSWORD`**. Only you get in.

## Keeping results after a race (optional, ~5 min)

The socket closes 5 minutes after the chequered flag, because the classification stops
changing there — an open connection afterwards fetches nothing new. Without somewhere to keep
the final order, a cold serverless start hours later has to re-read the static archive to fill
the results ticker, and that is a ~7.5 MB download (measured at 8-9 s). Two small tables
remove it.

It matters most for practice and qualifying. Those exist *only* in the live socket, and F1's
own archive does not publish a session for roughly 40-60 minutes after it ends (measured at the
2026 Italian GP) — so without this the ticker sits empty for the best part of an hour after
every session.

> A SQLite **file** cannot do this job on Vercel: the filesystem is ephemeral and
> per-invocation, so it would work in local dev and silently lose every race in production.

1. Create a free project at [supabase.com](https://supabase.com), in the **same region** you
   chose for Vercel's functions.
2. SQL Editor → New query → paste [`supabase/schema.sql`](supabase/schema.sql) → Run. It
   creates two tables: `round_result` (a race's classification, which feeds championship
   points) and `session_result` (the most recent finished session of any type, which keeps the
   results ticker fed). Re-running it is safe — both are `create table if not exists`.
3. Settings → API → copy the **Project URL** and the **`service_role`** key into
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Do not use the `anon` key — it cannot
   bypass RLS and every write fails silently.
4. Add `CRON_SECRET`, then redeploy. `vercel.json` registers a daily 01:00 UTC job at
   `/api/cron/recheck`, which lands ~10 h after a typical Sunday race and re-checks the
   result once per round for stewards' penalties. Vercel signs the call with that secret; the
   route returns **401** without it.

Check it with `curl -H "Authorization: Bearer YOUR_SECRET" https://YOUR-APP/api/cron/recheck`.
`no-store` means the Supabase vars are missing; `no-round` means it is working and there is
simply no session to re-check.

## Refreshing the token (~weekly)

The F1 TV token lasts ~4 days (the in-app banner warns you before it expires):

1. Grab a fresh token (F1 TV → DevTools → `login-session` cookie → `subscriptionToken`).
2. Vercel → your project → **Settings → Environment Variables** → edit `F1_TV_TOKEN`.
3. **Deployments** tab → latest → **⋯ → Redeploy** (env changes need a redeploy).

## Notes

- **Live tracking** works during sessions with or without a token: the timing board, tyres,
  sectors and race control come from an anonymous subscribe. A token adds the car dots and
  the telemetry card. Between sessions the socket is not opened at all.
- On free serverless, live updates are a touch slower and the track outline may be sparser
  than running locally — the timing board and car dots work the same.
- If live never connects on Vercel, it's almost always an expired/missing token — check the
  banner and the env var. (Outbound WebSocket from Vercel functions is supported.)
- Prefer zero cloud exposure? Run it locally instead (`npm start`) — same app, token in
  `.env.local`, reachable on your own network / via a private VPN like Tailscale.
