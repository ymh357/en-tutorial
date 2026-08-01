<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:youtube-pot-fallback-ops -->
# YouTube captions POT-fallback — operational requirements

YouTube auto-caption fetch (`api/youtube_captions.py`) has a best-effort fallback to a self-hosted POT provider when the local yt-dlp call is POT/risk-control blocked (503). The provider runs on a MacBook behind a cloudflared tunnel. **This fallback only works while the MacBook-side service is up.** See `docs/handoff-captions-pot.md` §"突破(2026-08-01)" for full architecture.

Three things MUST hold for YouTube auto-captions to work in prod:

1. **MacBook on + `~/yt-pot/start.sh` running.** If the MacBook is off or the service stopped, YouTube URLs degrade to 503 → the import page's paste-srt fallback (B站 path is unaffected — separate code). Start: `ssh` in and run `~/yt-pot/start.sh`; stop: `~/yt-pot/stop.sh`.
2. **`POT_PROVIDER_URL` Vercel env matches the current tunnel URL.** The tunnel uses cloudflared *quick* tunnel — the `*.trycloudflare.com` URL **rotates every restart**. After each `start.sh`, read the printed URL and update Vercel env `POT_PROVIDER_URL` (production), then redeploy (git push or `vercel --prod --yes`). `POT_PROVIDER_SECRET` is stable — do NOT rotate it. If `POT_PROVIDER_URL` is stale, the fallback silently fails (Vercel can't reach the old URL) and YouTube returns 503 → paste fallback.
3. **Cookies fresh on BOTH sides.** `~/yt-pot/cookies.txt` (Netscape format, MacBook) and Vercel env `YTC_COOKIES` must hold the **same** YouTube/Google session. bgutil computes the POT; cookies pass the bot check — both are required. YouTube rotates these session cookies periodically; when they expire, both files/envs must be re-exported together. Symptom of stale cookies: "Sign in to confirm you're not a bot" errors.

When changing the captions pipeline: `api/youtube_captions.py` is the only repo file for the fallback (stdlib `urllib`, no new Python dep). MacBook-side `~/yt-pot/*` scripts are NOT in the repo (ops artifacts). Tests for the Bilibili import live under `**/*.test.ts` (`npm test`); the YouTube fallback has no unit test (verified end-to-end against prod).
<!-- END:youtube-pot-fallback-ops -->

