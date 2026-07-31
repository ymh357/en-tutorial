// Minimal Bilibili helpers for the datacenter probe. Hardened in Task 2.
// SERVER-ONLY.

const BVID_RE = /BV[0-9A-Za-z]{10}/;

export const extractBvid = (url: string): string | null => {
  const m = url.match(BVID_RE);
  return m ? m[0] : null;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const biliHeaders = (): Record<string, string> => ({
  "User-Agent": UA,
  Referer: "https://www.bilibili.com",
  // bili connector may set cookies from BILI_SESSDATA env (Task 1 discovers if needed)
  ...(process.env.BILI_SESSDATA ? { Cookie: `SESSDATA=${process.env.BILI_SESSDATA}` } : {}),
});

// Resolve cid via view API. Returns { cid, title } or null.
export const resolveCid = async (
  bvid: string
): Promise<{ cid: number; title: string } | null> => {
  const r = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
    { headers: biliHeaders() }
  );
  const j = await r.json();
  if (j.code !== 0 || !j.data) return null;
  return { cid: j.data.cid, title: j.data.title };
};
