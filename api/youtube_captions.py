"""W4-T3: Vercel Services Python backend for YouTube caption retrieval.

Deployed as a Vercel Service alongside the Next.js frontend (see vercel.json
`services.captions`). Exposed publicly at /api/youtube_captions via a top-level
rewrite. The 2026-07-30 probe proved pure-HTTP fetch returns an empty timedtext
body (missing POT) while yt-dlp returns real captions under the same IP; this
service runs yt-dlp server-side so the frontend never needs a local helper.

Pure ASGI app (no framework) — Vercel Services' Python runtime loads the
`app` object named in the service `entrypoint: youtube_captions:app`.

Local run (not `next dev`): `vercel dev` boots all services together.
"""

import json
import os
import re
from urllib import error as urlerror
from urllib import request as urlrequest
from urllib.parse import parse_qs, urlencode

import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError

VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")

# Surface yt-dlp's raw error text only when explicitly enabled. Off by default:
# the text can carry signed URLs / internal endpoints we don't want to expose.
DEBUG_DETAIL = os.environ.get("YTC_DEBUG", "") not in ("", "0", "false")

# Best-effort fallback to a self-hosted POT provider (e.g. a MacBook running
# bgutil-ytdlp-pot-provider + yt-dlp behind a cloudflared tunnel). When the
# local yt-dlp call is POT-blocked (503) or produces nothing, the route asks
# the provider for the json3 captions instead. Both envs are optional: unset
# means "no provider configured" and the route behaves exactly as before
# (503 → the import page's paste-srt fallback). See docs/handoff-captions-pot.md.
POT_PROVIDER_URL = os.environ.get("POT_PROVIDER_URL", "").strip()
POT_PROVIDER_SECRET = os.environ.get("POT_PROVIDER_SECRET", "").strip()


def fetch_captions(video_id):
    """Download English subtitles as json3 via yt-dlp, return the raw json3 object.

    yt-dlp splits captions: `subtitles` for manually uploaded, and
    `automatic_captions` for auto-generated (the majority of long-tail topic
    videos). We merge both and prefer manual entries for a language when both
    exist. json3's POT handling is what makes this work where a bare fetch of
    the signed baseUrl returns an empty body.

    Raises DownloadError/ExtractorError (video unavailable, network, 429) to
    the caller for status mapping.
    """
    opts = {
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en", "en-orig"],
        "skip_download": True,
        "subtitlesformat": "json3",
        # serverless cwd is read-only -> write under /tmp. Use %(id)s (already
        # VIDEO_ID_RE-validated, path-safe) rather than %(title)s which can
        # contain '/' etc.
        "outtmpl": "/tmp/yt-caption-%(id)s.%(ext)s",
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    # YouTube blocks Vercel datacenter IPs with a cookies-based bot check
    # ("Sign in to confirm you're not a bot"). Without cookies every request
    # 503s. YTC_COOKIES holds a Netscape-format cookies.txt (exported from a
    # logged-in browser session) as an encrypted Vercel env var; materialize
    # it to /tmp per invocation (the runtime fs is read-only outside /tmp).
    # Use a small account — these cookies are a live Google session and a
    # busy serverless caller can trip YouTube anti-abuse.
    cookies_env = os.environ.get("YTC_COOKIES", "")
    if cookies_env.strip():
        cookies_path = "/tmp/yt-cookies.txt"
        with open(cookies_path, "w", encoding="utf-8") as f:
            f.write(cookies_env)
        opts["cookiefile"] = cookies_path
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)

    # Manual subtitles override auto for the same language code (more accurate).
    subs = {**(info.get("automatic_captions", {}) or {}), **(info.get("subtitles", {}) or {})}
    for lang in ("en-orig", "en"):
        entries = subs.get(lang)
        if not entries:
            continue
        json3_entry = next((e for e in entries if e.get("ext") == "json3"), None)
        if not json3_entry:
            continue
        filepath = json3_entry.get("filepath")
        if not filepath:
            continue
        try:
            with open(filepath, encoding="utf-8") as f:
                data = json.load(f)
            # Deferred ③: en-orig can yield a structurally valid but empty
            # json3 (events missing/None/[]) on some videos. Don't return that
            # — fall through to the next language (en) instead of silently
            # shipping an empty caption set. `if data.get("events"):` is falsy
            # for all three empty shapes. Each lang writes its own file under
            # /tmp, and the `finally` below removes this lang's filepath before
            # the loop advances — the next iteration opens a different file.
            if data.get("events"):
                return {"languageCode": lang, "json3": data}
        finally:
            # Reused warm containers keep /tmp; don't let captions accumulate.
            try:
                os.remove(filepath)
            except OSError:
                pass
    return None


def _pot_fallback(video_id):
    """Best-effort: ask the configured POT provider for json3 captions.

    Returns ``{"languageCode": str, "json3": dict}`` on success, ``None`` if the
    provider is unconfigured or the request fails (caller falls through to the
    normal error path). The provider is a separate host (bgutil + yt-dlp behind
    a tunnel) that can compute the POT YouTube requires — something this
    serverless function cannot do. Uses stdlib urllib only (no new dependency).
    """
    if not POT_PROVIDER_URL or not POT_PROVIDER_SECRET:
        return None
    target = f"{POT_PROVIDER_URL.rstrip('/')}?{urlencode({'v': video_id})}"
    req = urlrequest.Request(target, headers={"X-Pot-Secret": POT_PROVIDER_SECRET})
    try:
        with urlrequest.urlopen(req, timeout=45) as resp:
            if resp.status != 200:
                return None
            data = json.loads(resp.read().decode("utf-8"))
    except (urlerror.URLError, TimeoutError, ValueError):
        return None
    lang = data.get("languageCode")
    json3 = data.get("json3")
    if lang and isinstance(json3, dict) and json3.get("events"):
        return {"languageCode": lang, "json3": json3}
    return None


async def app(scope, receive, send):
    """Minimal ASGI app: GET ?v=VIDEOID -> caption JSON."""
    # Handle ASGI lifespan events correctly; a naive "http-only" guard would
    # otherwise send an http.response.start down a lifespan channel.
    if scope["type"] == "lifespan":
        while True:
            msg = await receive()
            if msg["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif msg["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return
        return

    if scope.get("method") != "GET":
        await _respond(send, 405, {"error": "GET only"})
        return

    qs = parse_qs(scope.get("query_string", b"").decode())
    video_id = (qs.get("v") or qs.get("id") or [None])[0]
    if not video_id or not VIDEO_ID_RE.match(video_id):
        await _respond(send, 400, {"error": "valid 11-char videoId required (v= or id=)"})
        return

    try:
        result = fetch_captions(video_id)
    except (ExtractorError, DownloadError) as e:
        # Map yt-dlp failures: unavailable/private -> 404; transient/network/429 -> 503.
        msg = str(e)
        lower = msg.lower()
        unavailable = any(
            s in lower for s in ("private", "unavailable", "does not exist", "removed")
        )
        if unavailable:
            body = {"error": "caption source unavailable", "videoId": video_id}
            if DEBUG_DETAIL:
                body["detail"] = msg
            await _respond(send, 404, body)
            return
        # 503 case: YouTube is POT/risk-control blocking this serverless call.
        # Try the self-hosted POT provider before surfacing 503 (best-effort).
        fallback = _pot_fallback(video_id)
        if fallback is not None:
            await _respond(
                send,
                200,
                {
                    "videoId": video_id,
                    "languageCode": fallback["languageCode"],
                    "json3": fallback["json3"],
                },
            )
            return
        body = {"error": "caption fetch failed", "videoId": video_id}
        if DEBUG_DETAIL:
            body["detail"] = msg
        await _respond(send, 503, body)
        return
    except Exception as e:  # noqa: BLE001 — intentional ASGI catch-all so an unexpected (non yt-dlp) failure returns a clean 500 instead of a stack trace
        # Unexpected (non yt-dlp) error — keep the diagnostic behind the flag too.
        body = {"error": "internal error", "videoId": video_id}
        if DEBUG_DETAIL:
            body["detail"] = str(e)
        await _respond(send, 500, body)
        return

    if result is None:
        # Local yt-dlp produced nothing; try the POT provider before 404.
        fallback = _pot_fallback(video_id)
        if fallback is not None:
            await _respond(
                send,
                200,
                {
                    "videoId": video_id,
                    "languageCode": fallback["languageCode"],
                    "json3": fallback["json3"],
                },
            )
            return
        await _respond(
            send,
            404,
            {"error": "no captions produced", "videoId": video_id},
        )
        return

    await _respond(
        send,
        200,
        {
            "videoId": video_id,
            "languageCode": result["languageCode"],
            "json3": result["json3"],
        },
    )


async def _respond(send, status, body):
    payload = json.dumps(body).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(payload)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": payload})
