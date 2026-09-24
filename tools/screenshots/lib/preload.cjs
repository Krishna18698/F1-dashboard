/* eslint-disable @typescript-eslint/no-require-imports -- loaded with `node --require`, so it must be CommonJS */
/**
 * Preloaded into every Node process of the harness's dev server (via NODE_OPTIONS=--require).
 * Three jobs, all without touching the app's own code:
 *
 *  1. Fixed clock — Date starts at SHOT_NOW and then advances in real time, so countdowns tick
 *     and the car dots move, but every run starts from the same instant.
 *  2. Recorded network — every global fetch() is served from SHOT_FIXTURES. With
 *     SHOT_MODE=record it goes to the network and saves what came back; otherwise a missing
 *     fixture is a 503 plus a line in misses.log, never a silent live request.
 *  3. No sockets out — raw http(s) requests and WebSockets to anywhere but localhost fail.
 *     That's the SignalR hub (it uses node-fetch + ws, not global fetch), which would
 *     otherwise make the result depend on whatever F1 happens to be running today.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const NOW = Date.parse(process.env.SHOT_NOW || "");
const DIR = process.env.SHOT_FIXTURES;
const RECORD = process.env.SHOT_MODE === "record";

// ---- 1. clock -------------------------------------------------------------------------
if (Number.isFinite(NOW)) {
  const RealDate = Date;
  const offset = NOW - RealDate.now();
  // A plain function with its statics as OWN properties: Next copies Date's own properties
  // when it wraps the global, so a subclass (whose parse/UTC are only inherited) lost them.
  function FixedDate(...a) {
    const d = a.length === 0 ? new RealDate(RealDate.now() + offset) : new RealDate(...a);
    return new.target ? d : d.toString();
  }
  FixedDate.prototype = RealDate.prototype;
  FixedDate.now = () => RealDate.now() + offset;
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  globalThis.Date = FixedDate;
}

// ---- 3. no raw sockets out ------------------------------------------------------------
const blockedRequest = http.request.bind(http);
const local = (host) => !host || /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(String(host).replace(/:\d+$/, ""));
for (const mod of [http, https]) {
  for (const fn of ["request", "get"]) {
    const real = mod[fn];
    mod[fn] = function (...args) {
      const a = args[0];
      const host = typeof a === "string" || a instanceof URL ? new URL(a).hostname : a?.hostname || a?.host;
      if (!local(host)) {
        // Port 9 (discard) refuses at once: the caller sees an ordinary connection error.
        return blockedRequest("http://127.0.0.1:9/blocked-by-screenshot-harness");
      }
      return real.apply(mod, args);
    };
  }
}
if (globalThis.WebSocket) {
  const RealWS = globalThis.WebSocket;
  globalThis.WebSocket = class extends RealWS {
    constructor(url, ...rest) {
      if (!local(new URL(url).hostname)) super("ws://127.0.0.1:9/blocked", ...rest);
      else super(url, ...rest);
    }
  };
}

// ---- 2. recorded network --------------------------------------------------------------
if (DIR && typeof globalThis.fetch === "function") {
  fs.mkdirSync(DIR, { recursive: true });
  const realFetch = globalThis.fetch;
  const keyOf = (method, url, body) =>
    crypto.createHash("sha1").update(`${method} ${url} ${body ?? ""}`).digest("hex").slice(0, 20);

  globalThis.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      return realFetch(input, init);
    }
    if (local(host)) return realFetch(input, init);
    // F1's SignalR hub: refused like the raw sockets above, so every run takes the same no-hub path.
    if (/\/signalr/i.test(new URL(url).pathname)) throw new TypeError("fetch failed (blocked by screenshot harness)");
    const body = typeof init.body === "string" ? init.body : undefined;
    const key = keyOf(method, url, body);
    const meta = path.join(DIR, `${key}.json`);
    const data = path.join(DIR, `${key}.body`);

    if (!RECORD) {
      if (fs.existsSync(meta)) {
        const m = JSON.parse(fs.readFileSync(meta, "utf8"));
        return new Response(m.status === 204 || m.status === 304 ? null : fs.readFileSync(data), {
          status: m.status,
          headers: m.contentType ? { "content-type": m.contentType } : {},
        });
      }
      fs.appendFileSync(path.join(DIR, "misses.log"), `${method} ${url}\n`);
      return new Response("not recorded", { status: 503 });
    }

    // Record: never replay a write to a real service.
    if (method !== "GET" && method !== "HEAD") return new Response("blocked", { status: 503 });
    const res = await realFetch(url, { method, headers: init.headers });
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(data, buf);
    fs.writeFileSync(meta, JSON.stringify({ url, method, status: res.status, contentType: res.headers.get("content-type") }));
    return new Response(res.status === 204 || res.status === 304 ? null : buf, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "" },
    });
  };
}
