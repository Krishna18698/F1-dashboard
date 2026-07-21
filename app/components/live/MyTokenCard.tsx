"use client";

import { useEffect, useState } from "react";
import { decodeTokenExpiry, looksLikeJwt } from "@/lib/tokenExpiry";
import { clearStoredVisitorToken, getStoredVisitorToken, setStoredVisitorToken } from "@/lib/visitorToken";

const code = "rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.68rem] text-white/85";

/**
 * Lets a visitor add their OWN F1 TV token for real-time tracking, instead of relying on
 * the site owner's. Stored ONLY in this browser's localStorage; sent to the server as a
 * request header (never a URL) on live-data polls, used for exactly that one request, and
 * never logged or persisted server-side — see the handling notes in lib/f1Relay.ts.
 */
export default function MyTokenCard({
  tokenIssue,
  ownerHasToken,
}: {
  tokenIssue?: "invalid" | "busy" | null;
  /** The site already has its own F1_TV_TOKEN configured — nothing being live right now is
   *  just a fact about the world, not something a visitor's own token would fix, so don't
   *  invite them to add one. Still shows if THEY already saved one (their choice to keep). */
  ownerHasToken?: boolean;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [formatError, setFormatError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Deferred to a timer callback (not called synchronously in the effect body) — same
    // pattern as TimingBoard.tsx's useCountdown. Also sidesteps a server/client mismatch:
    // localStorage doesn't exist during SSR, so the first render must match that, then
    // pick up the real value right after mount.
    const id = setTimeout(() => setSaved(getStoredVisitorToken()), 0);
    return () => clearTimeout(id);
  }, []);

  function save() {
    const t = input.trim();
    if (!looksLikeJwt(t)) {
      setFormatError(true);
      return;
    }
    setStoredVisitorToken(t);
    setSaved(t);
    setInput("");
    setFormatError(false);
  }

  function remove() {
    clearStoredVisitorToken();
    setSaved(null);
    setExpanded(false);
  }

  const expiry = saved ? decodeTokenExpiry(saved) : null;

  // The owner's own token already covers this site — no reason to invite a visitor to add
  // theirs too unless they already have (in which case still show its status).
  if (!saved && ownerHasToken) return null;

  if (saved) {
    const expired = expiry?.expired;
    return (
      <div className="carbon-bg mb-4 flex items-center gap-3 rounded-lg px-4 py-3 ring-1 ring-white/10">
        <span className={`h-2 w-2 shrink-0 rounded-full ${expired || tokenIssue ? "bg-amber-400" : "bg-emerald-400"}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            Your F1 TV token{" "}
            {tokenIssue === "invalid" ? (
              <span className="text-amber-400">wasn&apos;t accepted</span>
            ) : tokenIssue === "busy" ? (
              <span className="text-amber-400">is busy right now</span>
            ) : expired ? (
              <span className="text-amber-400">has expired</span>
            ) : (
              <span className="text-emerald-400">is active</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-white/55">
            {tokenIssue === "invalid"
              ? "Double-check it's correct and not expired, or remove it to use the site's default view."
              : tokenIssue === "busy"
                ? "A lot of visitors are using their own tokens at once — this refreshes automatically, no action needed."
                : expired
                  ? "Add a fresh one below, or remove it to fall back to the site's default view."
                  : expiry?.hoursLeft != null
                    ? `Expires in about ${Math.max(0, Math.round(expiry.hoursLeft))}h. Kept only in this browser.`
                    : "Kept only in this browser — never sent to our server except to power your own view."}
          </p>
        </div>
        <button
          onClick={remove}
          className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="carbon-bg mb-4 rounded-lg px-4 py-3 ring-1 ring-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Add your own F1 TV token</p>
          <p className="mt-0.5 text-xs text-white/55">
            Get real-time tracking with your own subscription — kept only in your browser,
            never stored on this site&apos;s server.
          </p>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white"
        >
          {expanded ? "Cancel" : "Add token"}
        </button>
      </div>
      {expanded && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <input
            type="password"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setFormatError(false);
            }}
            placeholder="Paste your F1 TV token"
            className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 font-mono text-xs text-white placeholder:text-white/30 focus:border-red focus:outline-none"
          />
          {formatError && <p className="mt-1.5 text-xs text-red">That doesn&apos;t look like a valid token.</p>}
          <p className="mt-2 text-[0.7rem] leading-relaxed text-white/45">
            Log in at f1tv.formula1.com → DevTools → Application → Cookies → copy the{" "}
            <code className={code}>login-session</code> cookie&apos;s <code className={code}>subscriptionToken</code>.
          </p>
          <button
            onClick={save}
            disabled={!input.trim()}
            className="mt-2 rounded-md bg-red px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
