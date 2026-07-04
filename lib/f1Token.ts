import "server-only";

/** Non-sensitive status of F1_TV_TOKEN — decodes only the JWT `exp`, never the token. */
export interface TokenStatus {
  present: boolean;
  expired: boolean;
  hoursLeft: number | null;
  expiresAt: string | null;
}

export function getTokenStatus(): TokenStatus {
  const t = process.env.F1_TV_TOKEN?.trim();
  if (!t) return { present: false, expired: false, hoursLeft: null, expiresAt: null };
  try {
    const payload = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());
    const expMs = Number(payload.exp) * 1000;
    if (!Number.isFinite(expMs)) return { present: true, expired: false, hoursLeft: null, expiresAt: null };
    const hoursLeft = (expMs - Date.now()) / 3_600_000;
    return {
      present: true,
      expired: hoursLeft <= 0,
      hoursLeft: Math.round(hoursLeft * 10) / 10,
      expiresAt: new Date(expMs).toISOString(),
    };
  } catch {
    return { present: true, expired: false, hoursLeft: null, expiresAt: null };
  }
}
