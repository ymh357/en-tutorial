# Bilibili Import — Design Spec

> Status: design self-audited (probed). Next: implementation plan.
> Per user: self-review only, no human review gate before planning.
> Date: 2026-07-31.
> Companion: `docs/handoff-captions-pot.md` (why YouTube is abandoned as the auto-fetch platform).

## Goal

Let a learner paste a Bilibili URL → the app auto-fetches English subtitles + a playable video stream → opens the existing three-stage intensive-listening flow (AB sentence bounds / shadowing / rate), with **no manual file preparation**. Bilibili is the *one* platform that satisfies auto-fetch, replacing the YouTube path that is POT-blocked in production.

## Scope (explicit, per user)

- **NOT** "support all platforms." One platform that can auto-fetch subtitles is enough. Bilibili is it.
- YouTube path stays as-is (cookies + yt-dlp best-effort + 503 → paste fallback). No POT revival.
- srt/vtt/json3 paste continues as the cross-platform lower bound, unchanged.
- No multi-platform registry abstraction. Two platforms, YAGNI — each self-contained so one breaking does not affect the other (handoff lesson #5).

## Why Bilibili, why now (evidence)

All probed live from an external (non-Bilibili-network) IP on 2026-07-31:

|Boundary|Probe result|Verdict|
|---|---|---|
|nav → wbi `img_key/sub_key`|`code:-101` (not logged in) but `wbi_img` returned normally; IP not blocked|✓ reachable|
|ranking `rid=0` (video metadata: bvid/aid/cid)|`code:0`, **no wbi, no cookie**|✓ reachable|
|`player/wbi/v2` (subtitle list)|`code:0`, **no wbi, no cookie** — endpoint does not enforce signature|✓ reachable|
|`ranking rid=36` (knowledge zone)|`-352` risk control|⚠ per-endpoint, engineering-solvable (wbi+UA+SESSDATA); NOT a POT-class dead-end|
|`playurl?fnval=16` (DASH)|`code:0` no wbi; `dash.video[]` (no audio) + `dash.audio[]` separated|✓ but DASH needs MSE — rejected for this design|
|`playurl?fnval=1&qn=16` (mp4/durl)|`code:0` no wbi; **single-segment mp4** `durl[0]`, `format:"mp4"`, signed `deadline`, ~10.6MB/148s|✓ **this is the chosen path**|

**Contrast with YouTube POT dead-end:** YouTube `timedtext` requires a Proof-of-Origin Token computed by runtime browser JS — impossible in serverless (5 paths falsified, see handoff). Bilibili's anti-crawl is wbi signature (pure MD5) + UA + possibly `SESSDATA` cookie — **all pure computation/cookie, no browser runtime**. Both load-bearing endpoints (`player/wbi/v2`, `playurl`) returned `code:0` unsigned from an external IP. No POT-class dead-end exists.

## Two residual risks (NOT dead-ends — resolved by implementation Task 1 probe on Vercel)

1. **CDN `Referer` check + datacenter-IP stream download reachability.** Probed from a home external IP; the signed mp4 URL likely requires `Referer: https://www.bilibili.com` (Bilibili CDN convention). Vercel datacenter IP may be risk-controlled at the CDN-download layer even though the metadata endpoints are not. This is the genuine last-mile unknown. **Task 1 of the plan must probe the full chain on Vercel** (captions + `view` cid + `playurl` + actually downloading the mp4 stream with/without Referer, from a Vercel deployment), per systematic-debugging "complete evidence at the datacenter boundary." If `playurl`/CDN require a cookie, add `BILI_SESSDATA` env (mirrors the `YTC_COOKIES` pattern; use a small B站 account; risk profile far below a Google session).
2. **English-subtitle scarcity on Bilibili.** Bilibili AI subtitles are Chinese-dominant; English CC exists only on English-content uploads (TED搬运, English learning, English-language tutorials). When a video has no English subtitle track, fall back to paste (existing). LLM Chinese→English subtitle translation is a possible future extension — **out of scope this version.**

## Technical decisions (with rationale)

### D1. Bilibili backend in Next.js Node routes, NOT a new Python service
Bilibili needs no yt-dlp — wbi signature is pure MD5, subtitles are plain HTTP JSON, playurl is plain HTTP. Node `crypto` + `fetch` cover everything. This avoids the Python service build/cookies complexity entirely and decouples Bilibili from the YouTube Python service. Routes live under `app/api/bilibili/`.

### D2. Playback via a NEW `createVideoPlayer` backed by `HTMLVideoElement`, NOT Bilibili's native iframe
The Bilibili iframe (`//player.bilibili.com/player?bvid=`) exposes **no JS player object / no currentTime readback** — the existing AB-sentence-bound mechanism (`media-source.ts:164-178` polls `getCurrentTime()` every 100ms) cannot be driven through it. The chosen path: backend resolves a **single signed mp4 stream URL** (`playurl?fnval=1&qn=16` → `durl[0]`, prefer `backup_url[0]` standard CDN host) → `createVideoPlayer({ src, host, onExpired })` (see O1) mirrors `createAudioPlayer` (`HTMLVideoElement` mounted in `host`, `currentTime` polling for AB bounds — currentTime is always readable on a media element). No MSE, no `dash.js`/`flv.js`, no new dependency. The signed URL expires; `onError` internally calls the `onExpired` callback to re-resolve once (see O1).

### D3. Platform dispatch by URL domain, no registry abstraction
Exactly two platforms. `extractVideoId` non-null → YouTube (existing `createYouTubePlayer`). `extractBvid` non-null → Bilibili. `mediaType:"video"` no longer means only YouTube. A `.mediaType === "video"` branch in `shadowing-tab.tsx` becomes platform-aware.

### D4. Subtitle normalization via a new `parseBilibili`, reusing the platform-neutral parse core
`lib/subtitle-parse.ts`'s four existing parsers are platform-neutral (only the `[`/`(` speech-marker filter at `:26-28` is YouTube-specific). Bilibili subtitle JSON is `{ body: [{ from, to, content }, ...] }` in seconds. Add `parseBilibili(data)` mapping `from*1000 → audioStartMs`, `to*1000 → audioEndMs`, `content → text`, returning `MaterialSentence[]` via the existing `toSentence` helper — same shape the YouTube path produces.

## Architecture (three layers)

### Layer 1 — Import page dispatch (`app/listening/import/page.tsx`)
- URL input identifies platform by domain: YouTube (existing) / Bilibili (new). Add `lib/bilibili.ts` `extractBvid` mirroring `extractVideoId` (`lib/youtube.ts:7`) — accepts `bilibili.com/video/BV...`, `b23.tv` short links (resolve redirect), `m.bilibili.com`.
- Bilibili mode: `extractBvid` → caption fetch (`parseBilibili`) → preview → "开始精听". Persist `Material { mediaType: "video", sourceKind: "authentic", sourceUrl: <bilibili watch URL>, sentences }`. The watch URL is permanent and re-derivable to bvid for stream resolution at playback.
- The existing YouTube mode + 503-paste fallback + audio-upload mode are untouched.

### Layer 2 — Backend fetch (Node routes under `app/api/bilibili/`)
- **`lib/bilibili.ts`** (pure, server-only): `extractBvid(url)`, `fetchMixinKey()` (fetch nav per request — serverless instances are stateless, so module-level caching has low hit rate; fetch fresh each call, one extra hop, acceptable), `wbiSign(params, mixinKey)` (MD5), `resolveCid(bvid)` (view API), `pickEnglishSubtitle(subtitles[])` (prefer `en-US`/`en`).
- **`app/api/bilibili/captions/route.ts`**: `GET ?bvid=` → wbi-sign `view` for cid → wbi-sign `player/wbi/v2` → pick English `subtitle_url` → fetch JSON → `parseBilibili` shape → `{ sentences, languageCode }`. On `-352`/no-English-subtitle/datacenter-block → `503` with Bilibili-specific copy (triggers existing paste fallback in import page).
- **`app/api/bilibili/media/route.ts`**: `GET ?bvid=` → resolve cid → `playurl?fnval=1&qn=16` → return `{ url: durl[0].backup_url[0] ?? base_url, cid, deadline }` (prefer standard-CDN backup host). On failure → `503`.

Problem: wbi is required only when an endpoint returns `-352`; probed endpoints returned `code:0` unsigned. **Strategy: try unsigned first, fall back to wbi-signed on `-352`.** This minimizes work in the common case and degrades gracefully if Bilibili tightens enforcement. `fetchMixinKey` is only called on the fallback path.

### Layer 3 — Playback contract (`components/listening/media-source.ts` + `shadowing-tab.tsx`)
- New `createVideoPlayer({ src, host }): MediaSource` mirroring `createAudioPlayer` (`audio-source.ts`), but mounting a `<video controls>` in `host` (visible picture). Same 100ms `currentTime` poll for endMs/AB-loop. Add a `reload(newSrc)` capability to the contract (or an internal re-load on `onError`) — see Open Issue O1.
- `shadowing-tab.tsx` video branch (`:314-325`) becomes platform-aware:
  - `extractVideoId(sourceUrl)` non-null → existing `createYouTubePlayer` (synchronous mount).
  - `extractBvid(sourceUrl)` non-null → **async resolve** stream URL (`/api/bilibili/media?bvid=`) in the effect, show loading state, then `createVideoPlayer`. On `onError` (expired URL) → re-resolve once.
  - The two video branches differ in lifecycle timing (YT sync vs Bilibili async); this is the React-19-strict-effect integration point — see Open Issue O3.

## Data flow

```
paste Bilibili URL (watch URL or b23.tv short link)
 → import page extractBvid
 → GET /api/bilibili/captions?bvid=
    → (try unsigned player/wbi/v2, -352 → wbi-sign) → pick English subtitle_url
    → fetch subtitle JSON → parseBilibili → { from*1000, to*1000, content }
 → MaterialSentence[] preview
 → dbHelpers.saveMaterial({ mediaType:"video", sourceUrl: watchURL, sentences })
 → router.push("/listening/video/<id>")
 → shadowing-tab: extractBvid(sourceUrl) non-null
    → async GET /api/bilibili/media?bvid= → { url: signed mp4 }
    → createVideoPlayer({ src: url, host }) → AB-bound intensive listening
    → onError (URL expired mid-session) → re-resolve once → reload
```

## Error handling / degradation

- **Caption fetch fails** (`-352` risk control / no English track / datacenter block): `503` → reuse existing paste-srt fallback in import page (copy adapted to Bilibili: "该视频暂无英文字幕或被风控拦截，请手动粘贴 srt/vtt 字幕，或改用音频上传：").
- **Media resolve fails** at playback: surface error + fall back is not needed (material already has sentences; learner can still read subtitles). Stream is for listening; if stream unavailable, the listening flow degrades to "read along".
- **Stream URL expires mid-session**: `onError` re-resolves once via `/api/bilibili/media`; second failure surfaces a persistent error.

## Constraints (project-wide, bind every task)

- `AGENTS.md`: this Next.js has breaking changes — read `node_modules/next/dist/docs/` before writing route/page code.
- Client-side Dexie (IndexedDB), singleton profile `id:"singleton"`. `Material.sourceUrl` is NOT indexed (Dexie index is `id, topic, mediaType, createdAt` per `lib/db.ts:284`), so no index migration needed.
- Type-check `npx tsc --noEmit` + lint `npx eslint . --quiet` must be 0-error before commit. Python `npm run lint:py` (ruff) only touches `youtube_captions.py` — NOT touched by this design.
- Per-task code-reviewer gate. Commit footer `Co-Authored-By: Claude <noreply@anthropic.com>`, direct to main (authorized). Push needs user authorization.
- Code comments English only. No tests written (CLAUDE.md).

## Out of scope (do NOT do)

- Platform全集 / multi-platform registry abstraction.
- YouTube POT revival (external persistent Chromium POT provider — fragile on user's Mac, ongoing cat-and-mouse).
- Bilibili native iframe embedding (no control API — feasibility n/a).
- LLM Chinese→English subtitle machine translation (future).
- `dash.js`/`flv.js`/MSE dual-track (rejected: new dependency + timing complexity; single-mp4 path suffices at 360P).
- Migrating the YouTube captions service to Node (leave the Python service as-is).

## Open issues (resolved before/at plan time)

### O1 — Contract gap: no reload/swap-src method
The `MediaSource` contract (`media-source.ts:85-109`) has no method to swap the `src` after an expired-URL re-resolve. **Resolution:** `createVideoPlayer` owns the `<video>` element internally; its constructor opts are `{ src, host, onExpired: () => Promise<string> }` — contract type stays unchanged (other implementations don't need it); only `createVideoPlayer`'s opts type adds `onExpired`. When the `<video>` fires `onError`, `createVideoPlayer` calls `onExpired()` to fetch a fresh signed URL, then `video.src = newSrc; video.load()` — one retry; a second failure within the session surfaces a permanent error. The contract surface (play/pause/seekTo/...) is unchanged.

### O2 — `b23.tv` short-link resolution
`b23.tv` redirects to the canonical `bilibili.com/video/BV...` URL. `extractBvid` must follow the redirect (a HEAD/GET to `b23.tv/<code>` returns a 302 `Location`). For the import page this is a client-side `fetch(url, { redirect: "follow" })` then `extractBvid(response.url)`. Edge: some `b23.tv` links are app-share payloads with text — extract the URL from the payload first.

### O3 — React 19 strict-effect lifecycle divergence (YT sync vs Bilibili async)
`createYouTubePlayer` mounts synchronously (iframe API may resolve async internally, but the call is sync from the effect's view). `createVideoPlayer` for Bilibili needs an **async** `/api/bilibili/media` call before it can construct. Under React 19's `set-state-in-effect` rule, the effect body cannot `setState` (the existing code's pattern). **Resolution:** mirror the existing `shadowing-tab.tsx` approach — this file already handles media-source construction in its effect (the `sourceRef` pattern at `:172`); the Bilibili branch adds an async resolution step feeding into the same ref-with-flag mechanism, avoiding mid-effect setState by using a ref-state + render-time adjustment (as the codebase already does for `prevMaterialIdRef`). The plan's implementer must follow the existing file's strict-effect-safe pattern verbatim, not invent a new one.

### O4 — Prefer `backup_url` over `base_url`
`backup_url[0]` uses the standard `upos-sz-mirror*.bilivideo.com` host (works for any client); `base_url` can be a custom-host CDN URL (the probe showed a `mountaintoys.cn:4483` host) that may be region/ISP-specific. Always use `durl[0].backup_url[0]` first, fall back to `base_url`.

## Implementation order (sketch — the plan will detail)

1. **Task 1: datacenter probe (BLOCKER).** Deploy a minimal route to Vercel that exercises the full chain (captions unsigned→wbi, view→cid, playurl→durl mp4, stream download with/without Referer) and logs results. Confirms both residual risks before building the UI. If `BILI_SESSDATA` is needed, this is where it's discovered.
2. `lib/bilibili.ts` (extractBvid, wbiSign, fetchMixinKey, resolveCid, pickEnglishSubtitle).
3. `app/api/bilibili/captions/route.ts` + `parseBilibili` in `lib/subtitle-parse.ts`.
4. `app/api/bilibili/media/route.ts`.
5. `createVideoPlayer` in `components/listening/media-source.ts`.
6. `shadowing-tab.tsx` platform-aware video branch + `createVideoPlayer` wiring + async resolve + onError re-resolve.
7. `app/listening/import/page.tsx` Bilibili mode UI + dispatch.
8. Broad whole-branch review.
