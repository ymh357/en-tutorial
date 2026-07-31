// Pure, client-safe Bilibili helpers. No Node APIs, no "server-only".
// Imported by both server code (lib/bilibili.ts) and client components
// (shadowing-tab.tsx, import/page.tsx).

export const BVID_RE = /BV[0-9A-Za-z]{10}/;

export const extractBvid = (url: string): string | null => {
  const m = url.match(BVID_RE);
  return m ? m[0] : null;
};

// Client-safe check for "is this a Bilibili URL at all" (canonical watch URL
// or unresolved b23.tv short link) — used to pick the Bilibili branch before
// resolution. Does not resolve b23 links; see lib/bilibili.ts#resolveBvid for
// that (server-only, no CORS).
export const isBilibiliLink = (url: string): boolean =>
  extractBvid(url) != null || /b23\.tv|bilibili\.com/i.test(url);
