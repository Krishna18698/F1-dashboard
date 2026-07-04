# Deploy your private dashboard for free (Vercel)

Get your dashboard live at a URL you can open from anywhere — **free, no card, only you**.

## Why Vercel

The live relay is **stateless** (each request opens a quick connection to F1's feed and
closes), so it runs on Vercel's free **Hobby** tier — which needs no credit card and is
always available. A password gate (`DASHBOARD_PASSWORD`) keeps it private to you.

> Personal/non-commercial use only — that's exactly what the free Hobby tier is for, and
> you must never expose your F1 TV token publicly (the password gate prevents that).

## One-time setup (~5 min)

1. Go to **[vercel.com](https://vercel.com)** → **Sign up with GitHub** (free, no card).
2. **Add New… → Project** → import **`Krishna18698/F1-dashboard`**.
3. Before deploying, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `F1_TV_TOKEN` | your F1 TV `subscriptionToken` (the `eyJ…` JWT) |
   | `DASHBOARD_PASSWORD` | any password you choose |

4. Click **Deploy**. In ~1 min you get a URL like `https://f1-dashboard-xxx.vercel.app`.
5. Open it from your phone anywhere → browser asks for login → **username: anything**,
   **password: your `DASHBOARD_PASSWORD`**. Only you get in.

## Refreshing the token (~weekly)

The F1 TV token lasts ~4 days (the in-app banner warns you before it expires):

1. Grab a fresh token (F1 TV → DevTools → `login-session` cookie → `subscriptionToken`).
2. Vercel → your project → **Settings → Environment Variables** → edit `F1_TV_TOKEN`.
3. **Deployments** tab → latest → **⋯ → Redeploy** (env changes need a redeploy).

## Notes

- **Live tracking** works during sessions once the token is set. Between sessions (or if the
  token lapses) it shows the free static feed / minimizes — nothing breaks.
- On free serverless, live updates are a touch slower and the track outline may be sparser
  than running locally — the timing board and car dots work the same.
- If live never connects on Vercel, it's almost always an expired/missing token — check the
  banner and the env var. (Outbound WebSocket from Vercel functions is supported.)
- Prefer zero cloud exposure? Run it locally instead (`npm start`) — same app, token in
  `.env.local`, reachable on your own network / via a private VPN like Tailscale.
