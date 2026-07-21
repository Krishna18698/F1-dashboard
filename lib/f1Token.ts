import "server-only";
import { decodeTokenExpiry } from "./tokenExpiry";

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
  return { present: true, ...decodeTokenExpiry(t) };
}
