// Pure, client-safe Bilibili helpers. No Node APIs, no "server-only".
// Imported by both server code (lib/bilibili.ts) and client components
// (shadowing-tab.tsx, import/page.tsx).

export const BVID_RE = /BV[0-9A-Za-z]{10}/;

export const extractBvid = (url: string): string | null => {
  const m = url.match(BVID_RE);
  return m ? m[0] : null;
};
