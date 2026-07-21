/**
 * Pure JWT-expiry decoding — no secrets, no server dependency. Reads only the `exp` claim
 * from the token's own (unencrypted) payload segment, never anything sensitive. Safe to run
 * both server-side (lib/f1Token.ts, the site's own F1_TV_TOKEN) and client-side (a visitor's
 * own token, decoded in their browser so they see its expiry without it ever leaving there).
 */
export interface TokenExpiry {
  expired: boolean;
  hoursLeft: number | null;
  expiresAt: string | null;
}

export function decodeTokenExpiry(token: string): TokenExpiry {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
    };
    const expMs = Number(payload.exp) * 1000;
    if (!Number.isFinite(expMs)) return { expired: false, hoursLeft: null, expiresAt: null };
    const hoursLeft = (expMs - Date.now()) / 3_600_000;
    return {
      expired: hoursLeft <= 0,
      hoursLeft: Math.round(hoursLeft * 10) / 10,
      expiresAt: new Date(expMs).toISOString(),
    };
  } catch {
    return { expired: false, hoursLeft: null, expiresAt: null };
  }
}

/** A token is at least JWT-shaped: three dot-separated base64url segments. Cheap sanity
 *  check before ever attempting a connection with it. */
export function looksLikeJwt(token: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token.trim());
}
