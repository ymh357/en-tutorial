// Server-only Bilibili helpers: view/cid resolution, wbi signing, subtitle fetch.
// No "server-only" import: this module uses node:crypto, which already fails
// hard if bundled into a client component, giving the same guard.
import crypto from "node:crypto";

export { extractBvid } from "./bilibili-client";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export const biliHeaders = (): Record<string, string> => ({
  "User-Agent": UA,
  Referer: "https://www.bilibili.com",
  // Unsigned requests worked from a Vercel datacenter IP in Task 1's probe.
  // Kept as a documented fallback: B站 risk control is IP-reputation/rate
  // sensitive, so a -352 could surface under prod load later.
  ...(process.env.BILI_SESSDATA ? { Cookie: `SESSDATA=${process.env.BILI_SESSDATA}` } : {}),
});

// Resolve cid via view API. Returns { cid, title } or null.
export const resolveCid = async (
  bvid: string
): Promise<{ cid: number; title: string } | null> => {
  const r = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
    headers: biliHeaders(),
  });
  const j = await r.json();
  if (j.code !== 0 || !j.data) return null;
  return { cid: j.data.cid, title: j.data.title };
};

// --- WBI signing (fallback path; only needed when an endpoint returns -352) ---

export interface MixinKeyPair {
  imgKey: string;
  subKey: string;
}

const basenameNoExt = (url: string): string => {
  const file = url.split("/").pop() ?? "";
  return file.split(".")[0];
};

// Fetch nav to obtain the current img_key/sub_key used to derive the mixin key.
export const fetchMixinKey = async (): Promise<MixinKeyPair> => {
  const r = await fetch("https://api.bilibili.com/x/web-interface/nav", {
    headers: biliHeaders(),
  });
  const j = await r.json();
  const wbiImg = j?.data?.wbi_img;
  if (!wbiImg?.img_url || !wbiImg?.sub_url) {
    throw new Error("fetchMixinKey: nav response missing wbi_img");
  }
  return {
    imgKey: basenameNoExt(wbiImg.img_url),
    subKey: basenameNoExt(wbiImg.sub_url),
  };
};

// Fixed 64-entry Bilibili WBI mixin-key permutation table (publicly documented).
export const MIXIN_KEY_ENC_TABS = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
  28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 20, 51, 30, 6, 21, 34, 44,
  11, 25, 4, 22, 57, 52, 60, 56, 1, 59, 36, 63, 54, 62,
];

// Derive the 32-char mixin key from imgKey+subKey via the fixed permutation table.
export const getMixinKey = (orig: string): string =>
  MIXIN_KEY_ENC_TABS.map((i) => orig[i])
    .join("")
    .slice(0, 32);

// Sign params with wts + w_rid per Bilibili's WBI scheme.
export const wbiSign = (
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string
): Record<string, string> => {
  const mixinKey = getMixinKey(imgKey + subKey);
  const signed: Record<string, string> = {
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    wts: String(Math.floor(Date.now() / 1000)),
  };
  const query = Object.keys(signed)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(signed[k])}`)
    .join("&");
  const wRid = crypto
    .createHash("md5")
    .update(query + mixinKey)
    .digest("hex");
  return { ...signed, w_rid: wRid };
};

// --- Subtitle selection + fetch ---

export interface BiliSubtitleEntry {
  lan: string;
  is_lock?: boolean;
  subtitle_url: string;
  [key: string]: unknown;
}

// Prefer en-US, then en; skip locked (machine-pending) tracks.
export const pickEnglishSubtitle = (
  subtitles: BiliSubtitleEntry[] | undefined | null
): BiliSubtitleEntry | null => {
  if (!subtitles?.length) return null;
  const usable = subtitles.filter((s) => !s.is_lock);
  return (
    usable.find((s) => s.lan === "en-US") ?? usable.find((s) => s.lan === "en") ?? null
  );
};

// Bilibili subtitle_url is protocol-relative ("//..."); prepend https: and fetch.
export const fetchSubtitleJson = async (entry: BiliSubtitleEntry): Promise<unknown> => {
  const url = entry.subtitle_url.startsWith("http")
    ? entry.subtitle_url
    : `https:${entry.subtitle_url}`;
  const r = await fetch(url, { headers: biliHeaders() });
  return r.json();
};
