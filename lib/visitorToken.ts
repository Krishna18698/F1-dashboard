"use client";

// A visitor's own F1 TV token — kept ONLY in their browser's localStorage, never written
// anywhere server-side. Read by useF1Live.ts to attach as a request header; written/cleared
// by MyTokenCard.tsx.
const KEY = "pitwall:myF1Token";

export function getStoredVisitorToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setStoredVisitorToken(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {}
}

export function clearStoredVisitorToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
