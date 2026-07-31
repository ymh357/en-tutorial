# Bilibili Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a Bilibili URL → auto-fetch English subtitles + a playable 360P mp4 stream → open the existing three-stage intensive-listening flow, no manual file prep. Bilibili replaces the POT-blocked YouTube as the one auto-fetch platform.

**Architecture:** Three layers — import-page URL-domain dispatch; Node backend routes (`/api/bilibili/captions`, `/api/bilibili/media`) that hit Bilibili's HTTP APIs (wbi-signed only on `-352` fallback); a new `createVideoPlayer` (`HTMLVideoElement`) satisfying the existing `MediaSource` contract, wired into `shadowing-tab.tsx`'s now-platform-aware video branch. Single signed mp4 via `playurl?fnval=1&qn=16` (probed: single-segment, code:0 unsigned from external IP). No MSE, no new deps, no registry abstraction.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before route/page code), TypeScript strict, Dexie/IndexedDB client-side, Node `crypto`+`fetch` server-side.

## Global Constraints

- `AGENTS.md`: this Next.js has breaking changes — read `node_modules/next/dist/docs/` for route handlers / page params before coding.
- Client-side Dexie singleton `id:"singleton"`. `Material.sourceUrl` is NOT indexed (`lib/db.ts:284` index is `id, topic, mediaType, createdAt`) — no migration needed.
- Type-check `npx tsc --noEmit` + lint `npx eslint . --quiet` ZERO error before commit. Python/ruff untouched (Bilibili is Node-only).
- Per-task code-reviewer gate. Commit footer `Co-Authored-By: Claude <noreply@anthropic.com>`, direct to main (authorized). Push needs explicit user auth.
- Code comments ENGLISH only. No tests written (CLAUDE.md).
- `MaterialSentence { text; translation?; imageryHint?; audioStartMs?; audioEndMs? }` (`lib/types.ts:280-286`). `Material { ..., mediaType, sourceKind, sourceUrl?, sentences?, ... }` (`:292-306`).
- Existing subtitle parsers all return `MaterialSentence[]` via shared `toSentence(startMs, endMs, text)` (`lib/subtitle-parse.ts:30-38`); only the `[`/`(` filter at `:26-28` is YouTube-specific.
- `createAudioPlayer` (`components/listening/audio-source.ts:19`) is the pattern `createVideoPlayer` mirrors — read it fully before Task 5.
- `shadowing-tab.tsx:150` calls `extractVideoId` unconditionally for ANY video (i.e. `mediaType:"video"` currently means YouTube); `:314-325` is the player-construction if/else. Probe evidence (external IP, 2026-07-31): `player/wbi/v2` → code:0 unsigned; `playurl?fnval=1&qn=16` → code:0, single-segment mp4 `durl[0]`, signed `deadline`.

---

### Task 1: Datacenter probe (BLOCKER — confirms both residual risks before any UI)

**Files:**
- Create: `app/api/bilibili/_probe/route.ts` (TEMPORARY — deleted in Task 8 broad-review cleanup unless retained as a debug toggle)
- Create: `app/api/bilibili/_lib.ts` (minimal extractBvid + wbi helpers — expanded by Task 2)

**Interfaces:**
- Produces: a deployed GET endpoint that logs the full chain result so the controller can read it from Vercel logs.

**Context:** The spec's two residual risks (CDN `Referer` check + datacenter-IP reachability) are the last-mile unknowns. Per systematic-debugging, gather evidence at the datacenter boundary BEFORE building UI. This task probes on Vercel and decides whether `BILI_SESSDATA` env is needed. DO NOT write `wbiSign` fully here — only enough to test; Task 2 hardens it.

- [ ] **Step 1: Write the probe route**

`app/api/bilibili/_lib.ts`:
```typescript
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
```

`app/api/bilibili/_probe/route.ts` — exercises captions + view + playurl + stream-head, logs each step's status so the controller reads them from Vercel deployment logs:
```typescript
import { NextResponse } from "next/server";
import { extractBvid, resolveCid, biliHeaders } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bvid = new URL(req.url).searchParams.get("bvid");
  if (!bvid) return NextResponse.json({ error: "bvid required" }, { status: 400 });
  const log: string[] = [];

  // 1. view → cid
  const meta = await resolveCid(bvid);
  log.push(`view: ${meta ? `cid=${meta.cid} title=${meta.title}` : "FAILED"}`);
  if (!meta) return NextResponse.json({ log }, { status: 502 });

  // 2. player/wbi/v2 → subtitle list (unsigned attempt)
  const subR = await fetch(
    `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${meta.cid}`,
    { headers: biliHeaders() }
  );
  const subJ = await subR.json();
  const subs = subJ?.data?.subtitle?.subtitles ?? [];
  log.push(`captions: code=${subJ.code} subs=${JSON.stringify(subs.map((s: any) => s.lan))}`);

  // 3. playurl fnval=1 qn=16 → durl mp4
  const puR = await fetch(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${meta.cid}&qn=16&fnval=1&fnver=0&fourk=1`,
    { headers: biliHeaders() }
  );
  const puJ = await puR.json();
  const durl = puJ?.data?.durl ?? [];
  log.push(`playurl: code=${puJ.code} durlCount=${durl.length}`);

  // 4. stream download reachability — HEAD the mp4 with + without Referer
  if (durl[0]) {
    const streamUrl = durl[0].backup_url?.[0] ?? durl[0].url;
    for (const withRef of [true, false]) {
      try {
        const h = await fetch(streamUrl, {
          method: "HEAD",
          headers: withRef ? biliHeaders() : { "User-Agent": biliHeaders()["User-Agent"] },
          redirect: "follow",
        });
        log.push(`stream HEAD (referer=${withRef}): ${h.status} type=${h.headers.get("content-type")}`);
      } catch (e) {
        log.push(`stream HEAD (referer=${withRef}): ERR ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return NextResponse.json({ log });
}
```

- [ ] **Step 2: Deploy probe to Vercel and run**

Run: `vercel --prod --yes` (user pre-authorized prod deploy in prior sessions; confirm context still allows — if not, ask).
Then: `curl 'https://<prod>/api/bilibili/_probe?bvid=BV1qh3W6bEqf'`.
Expected: a `log` array revealing each step's code + the stream HEAD result.

- [ ] **Step 3: Interpret + decide BILI_SESSDATA**

Read `log`:
- If `captions: code=0` AND `playurl: code=0` AND a stream HEAD returns 2xx → **both risks clear, no cookie needed.** Proceed.
- If any endpoint `-352` OR stream HEAD 403/blocked → `BILI_SESSDATA` is needed. Set it in Vercel env (user provides a small B站 account SESSDATA cookie) and re-probe to confirm it unblocks.
- If stream HEAD fails regardless (CDN hard-blocks datacenter IPs) → STOP, report BLOCKED to user (would force fallback to audio-stream path or abandon datacenter-stream approach).

Record the finding in the SDD ledger before Task 2.

- [ ] **Step 4: Commit probe scaffolding**

```bash
git add app/api/bilibili/_lib.ts app/api/bilibili/_probe/route.ts
git commit -m "feat(bilibili): datacenter probe for captions+playurl+stream reachability"
```

---

### Task 2: `lib/bilibili.ts` hardened server helpers

**Files:**
- Modify: `app/api/bilibili/_lib.ts` → rename/move to `lib/bilibili.ts` (server-only, `import "server-only"`), expand with wbi + pickEnglishSubtitle.
- Update: `app/api/bilibili/_probe/route.ts` import path (or leave probe pointing at old path and delete with it in Task 8).

**Interfaces:**
- Produces: `extractBvid(url): string | null`, `biliHeaders()`, `fetchMixinKey(): Promise<{imgKey, subKey}>`, `wbiSign(params, mixinKey)`, `resolveCid(bvid)`, `pickEnglishSubtitle(subtitles): subtitleEntry | null`, `fetchSubtitleJson(entry): Promise<any>`.

Consumes (Task 3/4): the above. Consumes (Task 7): `extractBvid` from import page (client side — see Task 7 note that `extractBvid` must be importable client-side, so keep it in a separate `lib/bilibili-client.ts` OR mark only the pure `extractBvid` export without `import "server-only"`).

**Design:** wbi is required only when an endpoint returns `-352` (probed endpoints returned code:0 unsigned). Strategy: callers try unsigned first, fall back to wbi-signed. `fetchMixinKey` called only on fallback. The mixin-key permutation table is the known fixed 64-length index array (see spec WBI section); copy it verbatim.

**File layout decision (resolve now, not deferred):** Split pure client-safe helpers from server-only ones to satisfy "Task 6/7 import `extractBvid` client-side" cleanly:
- `lib/bilibili-client.ts` — PURE, no `import "server-only"`: only `extractBvid(url)` + `BVID_RE`. Imported by `shadowing-tab.tsx` (Task 6) and `import/page.tsx` (Task 7).
- `lib/bilibili.ts` — SERVER-ONLY (`import "server-only"`): re-exports `extractBvid` from `./bilibili-client` (so routes can use one import), plus `biliHeaders`, `fetchMixinKey`, `wbiSign`, `resolveCid`, `pickEnglishSubtitle`, `fetchSubtitleJson`.
Task 1's `app/api/bilibili/_lib.ts` is replaced by `lib/bilibili.ts` here (move + expand; update the probe's import in Step 3).

- [ ] **Step 1: Create `lib/bilibili-client.ts`** — `BVID_RE = /BV[0-9A-Za-z]{10}/` and `export const extractBvid = (url: string): string | null => url.match(BVID_RE)?.[0] ?? null`. Pure, no server-only, no Node APIs.

- [ ] **Step 2: Create `lib/bilibili.ts`** (server-only, `import "server-only"`): re-export `extractBvid` from `./bilibili-client`; add `biliHeaders()` (with optional `BILI_SESSDATA` cookie), `fetchMixinKey()` (fetch nav, parse `wbi_img.img_url`/`sub_url`, basename without extension), the 64-entry MIXIN_KEY_ENC_TABS array verbatim, `getMixinKey(orig)`, `wbiSign(params, imgKey, subKey)` (add wts, sort, urlencode, md5(query+mixinKey) → w_rid), `resolveCid`, `pickEnglishSubtitle(subs)` (prefer `lan==="en-US"` then `"en"`, skip `is_lock`), `fetchSubtitleJson(entry)` (prepend `https:`, fetch, return parsed body).

Use Node `crypto` (`import crypto from "node:crypto"`) for MD5: `crypto.createHash("md5").update(...).digest("hex")`.

- [ ] **Step 3: Update `app/api/bilibili/_probe/route.ts`** import to `@/lib/bilibili` (drop the temporary `_lib.ts` — `git mv`/delete it).

- [ ] **Step 4: Verify type-check + lint**

Run: `npx tsc --noEmit` and `npx eslint . --quiet` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/bilibili-client.ts lib/bilibili.ts app/api/bilibili/_probe/route.ts
git rm app/api/bilibili/_lib.ts
git commit -m "feat(bilibili): wbi sign + cid resolve + english subtitle picker (client/server split)"
```

---

### Task 3: captions route + `parseBilibili`

**Files:**
- Create: `app/api/bilibili/captions/route.ts`
- Modify: `lib/subtitle-parse.ts` — add `parseBilibili` (+ optionally export). Reuse `toSentence` (`:30-38`).

**Interfaces:**
- Produces:
  - `parseBilibili(data: { body?: { from: number; to: number; content: string }[] }): MaterialSentence[]` — `body[].from*1000 → audioStartMs`, `to*1000 → audioEndMs`, `content → text`.
  - Route `GET /api/bilibili/captions?bvid=` → `{ bvid, cid, languageCode, sentences: MaterialSentence[] }` on 200; 503 on `-352`/no-English/datacenter-block (triggers import-page paste fallback); 404 on video-not-found.

- [ ] **Step 1: Add `parseBilibili` to `lib/subtitle-parse.ts`**

```typescript
// Bilibili subtitle JSON: { body: [{ from, to, content }, ...] } in seconds.
// Normalize to MaterialSentence with ms timestamps via the shared toSentence.
export const parseBilibili = (data: unknown): MaterialSentence[] => {
  const body = (data as { body?: { from?: number; to?: number; content?: string }[] } | null)?.body;
  if (!Array.isArray(body)) return [];
  return body
    .filter((s) => s && typeof s.content === "string" && s.content.trim().length > 0)
    .map((s) => toSentence((s.from ?? 0) * 1000, (s.to ?? 0) * 1000, s.content!.trim()));
};
```

- [ ] **Step 2: Write the route** — fetch view→cid, try unsigned `player/wbi/v2`, on `-352` wbi-sign + retry, `pickEnglishSubtitle`, fetch subtitle JSON, `parseBilibili`. Map failures to 503 (paste fallback) / 404.

```typescript
import { NextResponse } from "next/server";
import { resolveCid, biliHeaders, fetchMixinKey, wbiSign, pickEnglishSubtitle, fetchSubtitleJson } from "@/lib/bilibili";
import { parseBilibili } from "@/lib/subtitle-parse";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bvid = new URL(req.url).searchParams.get("bvid");
  if (!bvid) return NextResponse.json({ error: "bvid required" }, { status: 400 });

  const meta = await resolveCid(bvid);
  if (!meta) return NextResponse.json({ error: "video not found", bvid }, { status: 404 });

  // Try unsigned; -352 → wbi-signed retry.
  let subJ: any = await (
    await fetch(`https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${meta.cid}`, { headers: biliHeaders() })
  ).json();
  if (subJ.code === -352) {
    const mk = await fetchMixinKey();
    const signed = wbiSign({ bvid, cid: String(meta.cid) }, mk.imgKey, mk.subKey);
    subJ = await (
      await fetch(`https://api.bilibili.com/x/player/wbi/v2?${new URLSearchParams(signed)}`, { headers: biliHeaders() })
    ).json();
  }
  const subs = subJ?.data?.subtitle?.subtitles ?? [];
  const en = pickEnglishSubtitle(subs);
  if (!en) {
    return NextResponse.json(
      { error: "该视频暂无英文字幕或被风控拦截，请手动粘贴 srt/vtt 字幕，或改用音频上传：", bvid },
      { status: 503 }
    );
  }
  const body = await fetchSubtitleJson(en);
  const sentences = parseBilibili(body);
  if (sentences.length === 0) {
    return NextResponse.json({ error: "字幕解析为空", bvid }, { status: 503 });
  }
  return NextResponse.json({ bvid, cid: meta.cid, languageCode: en.lan, sentences });
}
```

- [ ] **Step 3: Type-check + lint** — `npx tsc --noEmit` && `npx eslint . --quiet`, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/bilibili/captions/route.ts lib/subtitle-parse.ts
git commit -m "feat(bilibili): captions route + parseBilibili normalization"
```

---

### Task 4: media route

**Files:**
- Create: `app/api/bilibili/media/route.ts`

**Interfaces:**
- Produces: `GET /api/bilibili/media?bvid=` → `{ url, cid, deadline }` (200) where `url = durl[0].backup_url[0] ?? durl[0].url`; 503 on failure. `qn=16`, `fnval=1`.

- [ ] **Step 1: Write the route** — resolveCid → `playurl?fnval=1&qn=16&fnver=0&fourk=1` (unsigned, -352 → wbi-sign retry) → pick `durl[0]`, prefer `backup_url[0]`.

```typescript
import { NextResponse } from "next/server";
import { resolveCid, biliHeaders, fetchMixinKey, wbiSign } from "@/lib/bilibili";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bvid = new URL(req.url).searchParams.get("bvid");
  if (!bvid) return NextResponse.json({ error: "bvid required" }, { status: 400 });
  const meta = await resolveCid(bvid);
  if (!meta) return NextResponse.json({ error: "video not found", bvid }, { status: 404 });

  const base = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${meta.cid}&qn=16&fnval=1&fnver=0&fourk=1`;
  let puJ: any = await (await fetch(base, { headers: biliHeaders() })).json();
  if (puJ.code === -352) {
    const mk = await fetchMixinKey();
    const signed = wbiSign({ bvid, cid: String(meta.cid), qn: "16", fnval: "1", fnver: "0", fourk: "1" }, mk.imgKey, mk.subKey);
    puJ = await (await fetch(`${base}&${new URLSearchParams(signed)}`, { headers: biliHeaders() })).json();
  }
  const durl = puJ?.data?.durl;
  if (!Array.isArray(durl) || !durl[0]) {
    return NextResponse.json({ error: "无法解析视频流（可能需登录或被风控）", bvid }, { status: 503 });
  }
  const url = durl[0].backup_url?.[0] ?? durl[0].url;
  return NextResponse.json({ url, cid: meta.cid });
}
```

- [ ] **Step 2: Type-check + lint** — 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/bilibili/media/route.ts
git commit -m "feat(bilibili): media route — single mp4 stream via playurl fnval=1"
```

---

### Task 5: `createVideoPlayer` in `media-source.ts`

**Files:**
- Modify: `components/listening/media-source.ts` — add `createVideoPlayer` mirroring `createAudioPlayer` (`audio-source.ts:19-206`).

**Interfaces:**
- Produces: `createVideoPlayer(opts: VideoPlayerOpts): MediaSource` where `VideoPlayerOpts { src: string; host: HTMLElement; onExpired?: () => Promise<string> }`. Same `MediaSource` contract (play/pause/seekTo/setRate/getAvailableRates/setAbLoop/onStateChange/onReady/onError/destroy). `onExpired` (optional) re-resolves a fresh signed URL on `<video>` error, one retry.

**READ FIRST:** `components/listening/audio-source.ts` in full — the poll/AB-loop/pendingPlay/onError/destroy mechanics are copied with `<video>` substituted for `<audio>`.

- [ ] **Step 1: Implement `createVideoPlayer`** — `const video = document.createElement("video"); video.src = opts.src; video.controls = true; opts.host.appendChild(video); video.load();`. Copy the `createAudioPlayer` body (loadedmetadata/onReady/playInternal/startPoll/AB-loop/onError/destroy) substituting `audio`→`video`. ADD: in the `error` event listener, if `opts.onExpired` and not already retried, call `opts.onExpired()` → `video.src = fresh; video.load()`, track a `retried` flag; second error → surface via `onErrorCbs`. Use `STANDARD_RATES` `[0.5,0.75,1,1.25,1.5,2]`. `destroy()` must remove the `<video>` from `host` (`host.removeChild(video)` if still attached) + clear src.

- [ ] **Step 2: Type-check + lint** — 0 errors. Confirm `MediaSource` type is returned (compiler enforces parity).

- [ ] **Step 3: Commit**

```bash
git add components/listening/media-source.ts
git commit -m "feat(listening): createVideoPlayer — HTMLVideoElement MediaSource impl"
```

---

### Task 6: `shadowing-tab.tsx` platform-aware video branch

**Files:**
- Modify: `components/listening/shadowing-tab.tsx` — video branch (`:314-325`) + extract (`:150`).

**Interfaces:**
- Consumes: `createVideoPlayer` (Task 5), `extractBvid` (Task 2 — pure client-safe export).
- Produces: a video branch that dispatches YouTube (existing `createYouTubePlayer`, sync) vs Bilibili (async `/api/bilibili/media` resolve → `createVideoPlayer`).

**CRITICAL — React 19 strict-effect:** This file already handles media-source construction in its effect via the `sourceRef` pattern (`:172`) and uses render-time ref-state adjustments (e.g. `prevMaterialIdRef`) to comply with `set-state-in-effect`. The Bilibili branch adds an **async** resolution step. Follow the existing file's strict-effect-safe pattern verbatim — do NOT invent a new pattern. The async resolve feeds into the same ref-with-flag mechanism; avoid mid-effect `setState`.

- [ ] **Step 1: Read the full `shadowing-tab.tsx`** effect region (`:140-330`) before editing — understand `sourceRef`, `playerHostRef`, `isVideo`/`isAudio`, and how the existing YT branch tees up `createYouTubePlayer`.

- [ ] **Step 2: Add `extractBvid` import** from `@/lib/bilibili` (pure export, client-safe). At `:150`-equivalent, also compute `const bvid = isVideo ? extractBvid(material?.sourceUrl) : null;` alongside `videoId`.

- [ ] **Step 3: Modify the video branch (`:314-325`)**: if `videoId` → existing `createYouTubePlayer`. ELSE if `bvid` → async: set a `mediaResolving` ref flag, `fetch("/api/bilibili/media?bvid="+bvid)` → `{ url }` → `createVideoPlayer({ src: url, host, onExpired: () => fetch("/api/bilibili/media?bvid="+bvid).then(r=>r.json()).then(j=>j.url) })`. Surface resolve failure via the existing error UI. The async resolution must not `setState` inside the effect body — use the ref-flag + render-time read pattern the file already uses.

- [ ] **Step 4: Type-check + lint** — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add components/listening/shadowing-tab.tsx
git commit -m "feat(listening): platform-aware video branch — YouTube + Bilibili dispatch"
```

---

### Task 7: Import page Bilibili mode

**Files:**
- Modify: `app/listening/import/page.tsx` — add Bilibili dispatch in video mode.

**Interfaces:**
- Consumes: `extractBvid` (client-safe), `/api/bilibili/captions` (Task 3), `parseBilibili` is server-side already (route returns `sentences`), `Material` save via `dbHelpers.saveMaterial`.

**Context:** The import page's video mode currently YouTube-only (`handleFetchCaptions` `:64-102`, `handleVideoStart` `:120-144`). Add platform detection: if `extractBvid(url)` → Bilibili caption fetch; else if `extractVideoId(url)` → existing YouTube. Persist Bilibili `sourceUrl` as the watch URL (permanent, re-derivable to bvid). The existing YouTube 503-paste fallback + audio mode stay untouched. Import `extractBvid` from `@/lib/bilibili-client` (created in Task 2 — pure, client-safe).

- [ ] **Step 1: Add Bilibili caption fetch** — a `handleFetchBilibili` (or extend `handleFetchCaptions` with platform branch): `extractBvid(url)` → `fetch("/api/bilibili/captions?bvid="+bvid)` → on 503 set paste fallback (reuse `setPasting(true)` + Bilibili-adapted error copy) → on 200 set `sentences` from `data.sentences` (already normalized). Thumbnail: omit (Bilibili thumbnails need a different API; leave `null` — preview card already handles `thumbnail={null}`).

- [ ] **Step 2: `handleVideoStart`** — already saves `{ mediaType:"video", sourceUrl: url.trim(), sentences }`; works for Bilibili unchanged (sourceUrl is the watch URL). Verify the URL is the canonical watch URL (if user pasted `b23.tv`, resolve redirect client-side first via `fetch(url, {redirect:"follow"})` then `setUrl(response.url)` before fetch-captions — see spec O2).

- [ ] **Step 3: UI** — the video mode toggle/button copy ("YouTube 视频") stays; the URL placeholder can mention both. Add a one-line helper text under the URL input: "支持 YouTube 与 B站 链接". Keep the audio-upload button as-is.

- [ ] **Step 4: Type-check + lint** — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/listening/import/page.tsx
git commit -m "feat(listening): import page Bilibili URL dispatch"
```

---

### Task 8: Broad whole-branch review + cleanup

**Files:**
- Delete (if probe not retained): `app/api/bilibili/_probe/route.ts`
- Review: full branch diff.

- [ ] **Step 1: Dispatch final code reviewer** on the whole branch (most capable model) — spec compliance + code quality, with the spec path `docs/superpowers/specs/2026-07-31-bilibili-import-design.md` and global constraints.

- [ ] **Step 2: Address findings** — ONE fix dispatch + one scoped re-review, adjudicate residuals.

- [ ] **Step 3: Delete the probe route** unless retained behind a debug flag (default: delete — it exposes internal chain details).

- [ ] **Step 4: Commit cleanup**

```bash
git rm app/api/bilibili/_probe/route.ts
git commit -m "chore(bilibili): remove datacenter probe scaffold"
```

- [ ] **Step 5: Update handoff** — append to `docs/handoff-captions-pot.md` (or a new `docs/handoff-bilibili-import.md`) the outcome: Bilibili auto-fetch landed, what the probe found re: datacenter/Referer, `BILI_SESSDATA` status, residual manual steps.

- [ ] **Step 6: Use superpowers:finishing-a-development-branch** (or direct-to-main per authorization).
