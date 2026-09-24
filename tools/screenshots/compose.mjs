/**
 * Turns the raw captures into deliverables:
 *   project/screens/framed/{desktop,mobile}/*.png   browser window / phone bezel with status bar
 *   project/contact-sheet.png                       every framed screen on one page
 *   project/covers/cover-{1,2,3}.png|jpg            4:3 portfolio covers (3200×2400 / 1600×1200)
 *   project/featured/pit-wall-card.png|jpg          portfolio card image, built to read at ~300px
 *   project/featured/pit-wall-website.png|jpg       the website itself, same format
 *   project/featured/card-preview*.png              each inside a Proof-of-Work style card
 *   docs/screenshots/**                             web-sized copies the README embeds (committed)
 *
 * Every composition is an HTML page rendered by Chromium, so layout is plain CSS.
 */
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { OUT, REPO } from "./config.mjs";

const RAW = path.join(OUT, "screens", "raw");
const ELEM = path.join(OUT, "screens", "elements");
const FRAMED = path.join(OUT, "screens", "framed");
const COVERS = path.join(OUT, "covers");
const FEATURED = path.join(OUT, "featured");
const URL_BAR = "f1-dashboard-pink.vercel.app";

const img = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
const raw = (vp, id) => img(path.join(RAW, vp, `${id}.png`));
const elem = (id) => img(path.join(ELEM, `${id}.png`));

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,800;1,700;1,800&family=Geist:wght@400;500;600;700&family=Instrument+Serif&display=block" rel="stylesheet">`;
const BASE_CSS = `*{box-sizing:border-box;margin:0;padding:0} body{font-family:Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}`;

// ---------- frames -------------------------------------------------------------------------

/** macOS-style browser window around a 1440×900 capture. */
function desktopFrame(src, { shadow = true } = {}) {
  return `<div class="win" style="width:1440px;border-radius:12px;overflow:hidden;background:#fff;
      ${shadow ? "box-shadow:0 40px 80px -20px rgba(0,0,0,.35),0 0 0 1px rgba(0,0,0,.12);" : "box-shadow:0 0 0 1px rgba(0,0,0,.12);"}">
    <div style="height:52px;background:#f1f1f3;border-bottom:1px solid #dcdce0;display:flex;align-items:center;padding:0 18px;gap:18px">
      <div style="display:flex;gap:8px">${["#ff5f57", "#febc2e", "#28c840"].map((c) => `<span style="width:12px;height:12px;border-radius:50%;background:${c};box-shadow:inset 0 0 0 .5px rgba(0,0,0,.15)"></span>`).join("")}</div>
      <div style="display:flex;gap:14px;color:#9a9aa2;font-size:18px">‹ ›</div>
      <div style="flex:1;display:flex;justify-content:center">
        <div style="width:520px;height:32px;border-radius:8px;background:#e4e4e8;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13.5px;color:#3f3f46">
          <svg width="11" height="13" viewBox="0 0 11 13"><rect x="1" y="5.5" width="9" height="7" rx="1.5" fill="#6b6b73"/><path d="M3 5.5V4a2.5 2.5 0 015 0v1.5" stroke="#6b6b73" stroke-width="1.4" fill="none"/></svg>
          ${URL_BAR}
        </div>
      </div>
      <div style="width:92px"></div>
    </div>
    <img src="${src}" style="display:block;width:1440px;height:900px">
  </div>`;
}

/** iPhone-style bezel: status bar above the page, Safari's bottom bar below, nothing under either. */
function phoneFrame(src, { shadow = true, time = "9:41", overlay = "" } = {}) {
  const icons = `<svg width="18" height="12" viewBox="0 0 18 12">${[0, 1, 2, 3].map((i) => `<rect x="${i * 4.6}" y="${9 - i * 3}" width="3.2" height="${3 + i * 3}" rx="1" fill="#000"/>`).join("")}</svg>
    <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.2 10.3 8.9a3.3 3.3 0 00-4.6 0z M8 2a9 9 0 016.3 2.6l1.3-1.3A10.9 10.9 0 008 0 10.9 10.9 0 00.4 3.3l1.3 1.3A9 9 0 018 2zm0 3.5a5.6 5.6 0 013.9 1.6l1.3-1.3a7.4 7.4 0 00-10.4 0l1.3 1.3A5.6 5.6 0 018 5.5z" fill="#000"/></svg>
    <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="#000" opacity=".4" fill="none"/><rect x="2" y="2" width="20" height="9" rx="2" fill="#000"/><path d="M25 4.5v4a2 2 0 000-4z" fill="#000" opacity=".4"/></svg>`;
  return `<div style="width:430px;height:884px;border-radius:68px;background:#0c0c0e;padding:20px;position:relative;
      ${shadow ? "box-shadow:0 50px 90px -25px rgba(0,0,0,.45),inset 0 0 0 2px #2a2a2e,0 0 0 1px #3a3a40;" : "box-shadow:inset 0 0 0 2px #2a2a2e,0 0 0 1px #3a3a40;"}">
    <div style="width:390px;height:844px;border-radius:50px;overflow:hidden;background:#fff;display:flex;flex-direction:column;position:relative">
      <div style="height:54px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:6px 30px 0 44px;font-weight:600;font-size:16px;letter-spacing:-.2px;background:#fff">
        <span>${time}</span><span style="display:flex;gap:6px;align-items:center">${icons}</span>
      </div>
      <div style="position:absolute;top:11px;left:50%;transform:translateX(-50%);width:124px;height:36px;border-radius:20px;background:#000"></div>
      <img src="${src}" style="display:block;width:390px;height:700px;flex:none">
      ${overlay ? `<div style="position:absolute;left:0;top:54px;width:390px;height:700px;pointer-events:none">${overlay}</div>` : ""}
      <div style="height:90px;flex:none;background:rgba(246,246,248,.96);border-top:.5px solid rgba(0,0,0,.12);display:flex;flex-direction:column;align-items:center;padding-top:10px">
        <div style="width:360px;height:44px;border-radius:13px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;font-size:15px;color:#111;gap:6px">
          <span style="font-size:13px;color:#6b6b73">AA</span><span style="flex:1;text-align:center">${URL_BAR}</span><span style="font-size:15px;color:#6b6b73">↻</span>
        </div>
        <div style="margin-top:auto;margin-bottom:8px;width:134px;height:5px;border-radius:3px;background:#000"></div>
      </div>
    </div>
  </div>`;
}

// ---------- rendering ----------------------------------------------------------------------

let browser;
async function render(html, file, { width, height, scale = 2, transparent = false, jpg = null }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  await page.setContent(`<!doctype html><html><head>${FONTS}<style>${BASE_CSS}</style></head><body style="width:${width}px;height:${height}px;${transparent ? "background:transparent" : ""}">${html}</body></html>`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent });
  if (jpg) {
    await page.setViewportSize({ width, height });
    const p2 = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: jpg.scale });
    await p2.setContent(await page.content(), { waitUntil: "networkidle" });
    await p2.evaluate(() => document.fonts.ready);
    await p2.screenshot({ path: jpg.file, type: "jpeg", quality: 90 });
    await p2.close();
  }
  await page.close();
}

const list = (vp) => (fs.existsSync(path.join(RAW, vp)) ? fs.readdirSync(path.join(RAW, vp)).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort((a, b) => rank(a) - rank(b)) : []);

async function frames() {
  for (const id of list("desktop")) {
    await render(`<div style="padding:40px 60px 90px">${desktopFrame(raw("desktop", id))}</div>`, path.join(FRAMED, "desktop", `${id}.png`), { width: 1560, height: 1082, transparent: true });
  }
  for (const id of list("mobile")) {
    await render(`<div style="padding:30px 40px 70px">${phoneFrame(raw("mobile", id))}</div>`, path.join(FRAMED, "mobile", `${id}.png`), { width: 510, height: 984, transparent: true });
  }
}

const LABELS = {
  home: "Home · race week",
  "weekend-schedule": "Weekend schedule",
  calendar: "Season calendar",
  standings: "Championship standings",
  constructors: "Constructors' standings",
  news: "Paddock Intel",
  "live-idle": "Live · nothing on track (empty)",
  "token-form-error": "Token form · validation error",
  replay: "Replay · last race",
  "replay-driver": "Replay · driver telemetry",
  "replay-race-control": "Replay · Race Control sheet",
  loading: "Loading skeleton",
  "race-home": "Race day · live hero",
  "race-live": "Live race · tracker + timing",
  "race-driver": "Live race · driver selected",
  "race-tyres": "Live race · tyre tracker",
  "race-control-sheet": "Live race · Race Control sheet",
  "race-battles": "Live race · on-track battles",
  "race-vsc-battles": "Battles · paused under VSC",
  "race-lap1-battles": "Battles · lap 1",
  "race-tracking-loading": "Live section · loading",
  "quali-live": "Live qualifying",
  "quali-driver": "Qualifying · driver selected",
  "practice-redflag": "Practice · red flag, clock held",
  offline: "Upstream down (error)",
};
// Contact sheet order = the order above (the journeys), anything unlisted last.
const rank = (id) => (id in LABELS ? Object.keys(LABELS).indexOf(id) : 999);

async function contactSheet() {
  const tile = (vp, id) =>
    `<figure style="display:flex;flex-direction:column;align-items:center;gap:10px"><img src="${img(path.join(FRAMED, vp, `${id}.png`))}" style="${vp === "desktop" ? "width:560px" : "width:190px"}"><figcaption style="font-size:15px;color:#3f3f46;font-weight:500">${LABELS[id] ?? id}</figcaption></figure>`;
  const d = list("desktop");
  const m = list("mobile");
  const rows = Math.ceil(d.length / 3) * 420 + Math.ceil(m.length / 7) * 440;
  const height = 260 + rows;
  const html = `<div style="background:#fff;width:1900px;min-height:${height}px;padding:70px 80px">
    <header style="display:flex;align-items:flex-end;justify-content:space-between;border-bottom:5px solid #0b0b0c;padding-bottom:14px;margin-bottom:36px">
      <h1 style="font-family:'Playfair Display',serif;font-size:52px;line-height:1">Krishna Shravan's <span style="color:#e10600">Pit Wall</span></h1>
      <span style="letter-spacing:.22em;text-transform:uppercase;font-size:13px;color:#8a8a92">Every screen · desktop &amp; mobile</span>
    </header>
    <h2 style="font-family:'Playfair Display',serif;font-size:28px;margin:0 0 18px">Desktop</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:28px 20px">${d.map((id) => tile("desktop", id)).join("")}</div>
    <h2 style="font-family:'Playfair Display',serif;font-size:28px;margin:44px 0 18px">Mobile</h2>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:28px 12px">${m.map((id) => tile("mobile", id)).join("")}</div>
  </div>`;
  const page = await browser.newPage({ viewport: { width: 1900, height: 1000 }, deviceScaleFactor: 1.5 });
  await page.setContent(`<!doctype html><html><head>${FONTS}<style>${BASE_CSS}</style></head><body>${html}</body></html>`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, "contact-sheet.png"), fullPage: true });
  await page.close();
}

// ---------- covers (4:3) -------------------------------------------------------------------

const CARBON = `background-color:#111114;background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.025) 0 2px,transparent 2px 6px),repeating-linear-gradient(-45deg,rgba(255,255,255,.025) 0 2px,transparent 2px 6px)`;
const wordmark = (size, dark) =>
  `<div style="font-family:'Playfair Display',serif;font-weight:800;font-size:${size}px;line-height:1;letter-spacing:-.01em;color:${dark ? "#fff" : "#0b0b0c"}">Krishna Shravan's <span style="color:#e10600">Pit Wall</span></div>`;
const eyebrow = (t, color) => `<div style="letter-spacing:.24em;text-transform:uppercase;font-size:17px;font-weight:600;color:${color}">${t}</div>`;

function cover1() {
  // The product on race day: desktop window with the live dashboard, phone over its corner.
  return `<div style="width:1600px;height:1200px;${CARBON};position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background:radial-gradient(900px 600px at 85% 20%,rgba(225,6,0,.28),transparent 70%)"></div>
    <div style="position:absolute;left:100px;top:96px">
      ${eyebrow("Live Formula 1 dashboard", "#e10600")}
      <div style="margin-top:22px">${wordmark(78, true)}</div>
      <p style="margin-top:22px;font-size:26px;color:rgba(255,255,255,.62);max-width:760px;line-height:1.4">Live timing, a driver tracker for every circuit, tyre strategy and the championship — on one page.</p>
    </div>
    <div style="position:absolute;left:100px;top:410px;transform:scale(.86);transform-origin:top left">${desktopFrame(raw("desktop", "race-live"))}</div>
    <div style="position:absolute;right:70px;top:470px;transform:scale(.8);transform-origin:top right">${phoneFrame(raw("mobile", "race-live"))}</div>
  </div>`;
}

function cover2() {
  // The tracker itself, big: map + timing board crops on the site's own paper.
  return `<div style="width:1600px;height:1200px;background:#fff;position:relative;overflow:hidden">
    <div style="position:absolute;left:90px;top:84px;right:90px;display:flex;justify-content:space-between;align-items:flex-end;border-bottom:6px solid #0b0b0c;padding-bottom:18px">
      <div style="font-family:'Playfair Display',serif;font-weight:800;font-size:64px;line-height:1">Driver <span style="font-style:italic;color:#e10600">Tracker</span></div>
      ${eyebrow("Madrid · Spanish Grand Prix", "#8a8a92")}
    </div>
    <img src="${elem("race-live-map")}" style="position:absolute;left:90px;top:230px;width:840px;border-radius:14px;box-shadow:0 30px 60px -20px rgba(0,0,0,.35)">
    <div style="position:absolute;left:970px;top:230px;width:540px;height:880px;overflow:hidden;border-radius:14px;box-shadow:0 30px 60px -20px rgba(0,0,0,.25);background:#fff">
      <img src="${elem("race-live-board")}" style="width:540px;display:block">
      <div style="position:absolute;inset:auto 0 0 0;height:140px;background:linear-gradient(transparent,#fff)"></div>
    </div>
  </div>`;
}

function cover3() {
  // Mobile: three phones on F1 red.
  const phones = ["race-home", "race-live", "standings"];
  return `<div style="width:1600px;height:1200px;background:#e10600;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background:repeating-linear-gradient(-60deg,rgba(0,0,0,.05) 0 60px,transparent 60px 140px)"></div>
    <div style="position:absolute;left:0;right:0;top:78px;text-align:center">
      ${eyebrow("In your pocket on race day", "rgba(255,255,255,.8)")}
      <div style="margin-top:18px;font-family:'Playfair Display',serif;font-weight:800;font-size:66px;color:#fff;line-height:1">Pit Wall, <span style="font-style:italic">on the phone</span></div>
    </div>
    <div style="position:absolute;left:0;right:0;top:300px;display:flex;justify-content:center;gap:70px">
      ${phones.map((id, i) => `<div style="transform:scale(.98) translateY(${i === 1 ? -30 : 20}px)">${phoneFrame(raw("mobile", id))}</div>`).join("")}
    </div>
  </div>`;
}

// ---------- featured card ------------------------------------------------------------------

/** Built for ~300px wide: one big product shot, one short line. */
function featuredCard() {
  return `<div style="width:1600px;height:1200px;background:#0d0d10;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;${CARBON}"></div>
    <div style="position:absolute;left:-200px;top:780px;width:2200px;height:70px;background:#e10600;transform:rotate(-24deg);opacity:.95"></div>
    <div style="position:absolute;left:-200px;top:900px;width:2200px;height:26px;background:#e10600;transform:rotate(-24deg);opacity:.55"></div>
    <div style="position:absolute;left:96px;top:92px;font-family:'Playfair Display',serif;font-weight:800;font-size:112px;line-height:1;color:#fff;letter-spacing:-.015em">Live F1, <span style="font-style:italic;color:#e10600">lap by lap.</span></div>
    <div style="position:absolute;left:40px;top:250px;width:980px;height:980px;background:radial-gradient(closest-side,rgba(225,6,0,.22),transparent)"></div>
    <img src="${elem("race-live-map")}" style="position:absolute;left:96px;top:280px;width:860px;border-radius:24px;box-shadow:0 40px 80px -20px rgba(0,0,0,.75),0 0 0 2px rgba(255,255,255,.08)">
    <div style="position:absolute;left:1010px;top:330px;width:760px;height:940px;overflow:hidden;border-radius:22px;background:#fff;box-shadow:0 40px 80px -20px rgba(0,0,0,.7)">
      <img src="${elem("race-live-board")}" style="width:760px;display:block">
    </div>
  </div>`;
}

/** The website itself, on both screens, under a one-line tagline: live tracking in a desktop window with the phone over its corner. */
function featuredWebsite() {
  return `<div style="width:1600px;height:1200px;background:#0d0d10;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;${CARBON}"></div>
    <div style="position:absolute;left:-300px;top:-200px;width:2400px;height:1500px;background:radial-gradient(900px 560px at 72% 72%,rgba(225,6,0,.5),transparent 70%)"></div>
    <div style="position:absolute;left:-200px;top:1010px;width:2400px;height:90px;background:#e10600;transform:rotate(-18deg);opacity:.9"></div>
    <div style="position:absolute;left:-200px;top:1150px;width:2400px;height:30px;background:#e10600;transform:rotate(-18deg);opacity:.45"></div>
    <div style="position:absolute;left:80px;top:64px;font-family:'Playfair Display',serif;font-weight:800;font-size:104px;line-height:1;color:#fff;letter-spacing:-.015em">The pit wall <span style="font-style:italic;color:#e10600">in your pocket.</span></div>
    <div style="position:absolute;left:64px;top:236px;transform:scale(.9);transform-origin:top left">${desktopFrame(raw("desktop", "race-live"))}</div>
    <div style="position:absolute;right:52px;top:300px;transform:scale(.97);transform-origin:top right">${phoneFrame(raw("mobile", "race-live"))}</div>
  </div>`;
}

/**
 * v2: the phone is the hero (leader selected, map + telemetry), the desktop tracker sits tilted
 * behind it, the leader's car glows, and the image carries the name and a live lap chip.
 */
function featuredWebsiteV2() {
  const focus = JSON.parse(fs.readFileSync(path.join(ELEM, "race-focus.json"), "utf8"));
  // Sized to the car's own selection ring (~15px across on a 390px-wide screen), just brighter.
  const glow = focus.x == null ? "" : `
    <div style="position:absolute;left:${focus.x - 11}px;top:${focus.y - 11}px;width:22px;height:22px;border-radius:50%;
      box-shadow:0 0 0 2px rgba(255,255,255,.95),0 0 12px 5px rgba(225,6,0,.75),0 0 26px 10px rgba(225,6,0,.35)"></div>
    <div style="position:absolute;left:${focus.x - 19}px;top:${focus.y - 19}px;width:38px;height:38px;border-radius:50%;border:1.5px solid rgba(225,6,0,.55)"></div>`;
  return `<div style="width:1600px;height:1200px;background:#0d0d10;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;${CARBON}"></div>
    <div style="position:absolute;left:0;top:0;width:1600px;height:1200px;background:radial-gradient(620px 620px at 1190px 780px,rgba(225,6,0,.5),transparent 70%)"></div>
    <div style="position:absolute;left:-200px;top:1040px;width:2400px;height:80px;background:#e10600;transform:rotate(-16deg);opacity:.85"></div>
    <div style="position:absolute;left:-200px;top:1170px;width:2400px;height:26px;background:#e10600;transform:rotate(-16deg);opacity:.4"></div>

    <div style="position:absolute;left:84px;top:66px;display:flex;align-items:center;gap:22px">
      <span style="letter-spacing:.3em;text-transform:uppercase;font-size:21px;font-weight:600;color:rgba(255,255,255,.62)">Pit Wall · Live F1 Dashboard</span>
      <span style="display:flex;align-items:center;gap:10px;background:#e10600;color:#fff;border-radius:999px;padding:8px 18px;font-size:19px;font-weight:700;letter-spacing:.14em">
        <span style="width:10px;height:10px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px rgba(255,255,255,.3)"></span>LIVE · LAP ${focus.lap ?? ""}</span>
    </div>
    <div style="position:absolute;left:80px;top:118px;font-family:'Playfair Display',serif;font-weight:800;font-size:100px;line-height:1;color:#fff;letter-spacing:-.015em">The pit wall <span style="font-style:italic;color:#e10600">in your pocket.</span></div>

    <div style="position:absolute;left:30px;top:300px;perspective:2600px">
      <div style="transform:rotateY(22deg) rotateX(5deg) scale(.8);transform-origin:left center;filter:brightness(.72) saturate(.9)">${desktopFrame(raw("desktop", "race-live"))}</div>
    </div>
    <div style="position:absolute;left:0;top:300px;width:1000px;height:900px;background:linear-gradient(90deg,transparent 55%,rgba(13,13,16,.55))"></div>

    <div style="position:absolute;left:880px;top:268px;transform:scale(1.1);transform-origin:top left;filter:drop-shadow(0 50px 70px rgba(0,0,0,.6))">${phoneFrame(raw("mobile", "race-focus"), { overlay: glow })}</div>
  </div>`;
}

function cardPreview(image = "pit-wall-card.png") {
  const chips = ["Next.js", "TypeScript", "Tailwind CSS", "SignalR", "Supabase", "Vercel"];
  return `<div style="width:760px;height:620px;background:#1b1b1d;position:relative;padding:40px 0 0 66px;font-family:Geist,system-ui,sans-serif">
    <div style="position:absolute;left:0;top:0;bottom:0;width:40px;background:repeating-linear-gradient(-55deg,#232326 0 1px,transparent 1px 7px);border-right:1px solid #2a2a2d"></div>
    <h2 style="font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:30px;color:#e8e8ea;letter-spacing:-.01em;margin-bottom:26px">Proof of Work</h2>
    <article style="width:318px;background:#232325;border:1px solid #333336;border-radius:10px;padding:6px 6px 14px">
      <img src="${img(path.join(FEATURED, image))}" style="display:block;width:304px;height:228px;border-radius:7px;object-fit:cover">
      <div style="padding:10px 8px 0">
        <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="font-size:17px;font-weight:500;color:#f2f2f3">Pit Wall</h3><span style="color:#8a8a92;font-size:15px">↗</span></div>
        <p style="margin-top:8px;font-size:12.5px;line-height:1.6;color:#8d8d95">Live Formula 1 dashboard — real-time timing, a driver tracker for every circuit, tyre strategy and the championship.</p>
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${chips.map((c) => `<span style="font-size:11.5px;color:#c9c9cf;border:1px solid #3a3a3e;background:#2a2a2d;border-radius:999px;padding:3px 9px">${c}</span>`).join("")}</div>
      </div>
    </article>
  </div>`;
}

// ---------- README images ------------------------------------------------------------------

/**
 * Web-sized copies for the README, in the repo (docs/screenshots) because project/ is gitignored
 * and GitHub can only show committed files. Rebuilt from scratch on every run so the README never
 * shows a screen the app no longer has. Desktop at 1x (1440×900), mobile at 2x, JPEG.
 */
async function readmeAssets() {
  const DOCS = path.join(REPO, "docs", "screenshots");
  fs.rmSync(DOCS, { recursive: true, force: true });
  const jpg = async (src, out, width, height, scale, quality) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(`<!doctype html><html><body style="margin:0"><img src="${img(src)}" style="display:block;width:${width}px;height:${height}px"></body></html>`, { waitUntil: "load" });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, type: "jpeg", quality });
    await page.close();
  };
  for (const id of list("desktop")) await jpg(path.join(RAW, "desktop", `${id}.png`), path.join(DOCS, "desktop", `${id}.jpg`), 1440, 900, 1, 82);
  for (const id of list("mobile")) await jpg(path.join(RAW, "mobile", `${id}.png`), path.join(DOCS, "mobile", `${id}.jpg`), 390, 700, 2, 72);
  for (const n of [1, 2, 3]) fs.copyFileSync(path.join(COVERS, `cover-${n}.jpg`), path.join(DOCS, `cover-${n}.jpg`));
  fs.copyFileSync(path.join(FEATURED, "pit-wall-website-v2.jpg"), path.join(DOCS, "featured.jpg"));
}

// ---------- main ---------------------------------------------------------------------------

browser = await chromium.launch();
try {
  await frames();
  console.log("✓ frames");
  await contactSheet();
  console.log("✓ contact sheet");
  const covers = [cover1, cover2, cover3];
  for (const [i, c] of covers.entries()) {
    const n = i + 1;
    await render(c(), path.join(COVERS, `cover-${n}.png`), { width: 1600, height: 1200, scale: 2, jpg: { file: path.join(COVERS, `cover-${n}.jpg`), scale: 1 } });
  }
  console.log("✓ covers");
  await render(featuredCard(), path.join(FEATURED, "pit-wall-card.png"), { width: 1600, height: 1200, scale: 2, jpg: { file: path.join(FEATURED, "pit-wall-card.jpg"), scale: 1 } });
  await render(featuredWebsite(), path.join(FEATURED, "pit-wall-website.png"), { width: 1600, height: 1200, scale: 2, jpg: { file: path.join(FEATURED, "pit-wall-website.jpg"), scale: 1 } });
  await render(featuredWebsiteV2(), path.join(FEATURED, "pit-wall-website-v2.png"), { width: 1600, height: 1200, scale: 2, jpg: { file: path.join(FEATURED, "pit-wall-website-v2.jpg"), scale: 1 } });
  await render(cardPreview(), path.join(FEATURED, "card-preview.png"), { width: 760, height: 620, scale: 2 });
  await render(cardPreview("pit-wall-website-v2.png"), path.join(FEATURED, "card-preview-website-v2.png"), { width: 760, height: 620, scale: 2 });
  await render(cardPreview("pit-wall-website.png"), path.join(FEATURED, "card-preview-website.png"), { width: 760, height: 620, scale: 2 });
  console.log("✓ featured");
  await readmeAssets();
  console.log("✓ README images (docs/screenshots)");
} finally {
  await browser.close();
}
