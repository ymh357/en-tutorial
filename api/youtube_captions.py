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
from urllib.parse import parse_qs

import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError

VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")

# Surface yt-dlp's raw error text only when explicitly enabled. Off by default:
# the text can carry signed URLs / internal endpoints we don't want to expose.
DEBUG_DETAIL = os.environ.get("YTC_DEBUG", "") not in ("", "0", "false")


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
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)

    # Manual subtitles override auto for the same language code (more accurate).
    subs = {**(info.get("automatic_captions", {}) or {}),
            **(info.get("subtitles", {}) or {})}
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
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {"languageCode": lang, "json3": data}
        finally:
            # Reused warm containers keep /tmp; don't let captions accumulate.
            try:
                os.remove(filepath)
            except OSError:
                pass
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
        unavailable = any(s in lower for s in
                          ("private", "unavailable", "does not exist", "removed"))
        status = 404 if unavailable else 503
        body = {"error": "caption source unavailable" if unavailable else "caption fetch failed",
                "videoId": video_id}
        if DEBUG_DETAIL:
            body["detail"] = msg
        await _respond(send, status, body)
        return
    except Exception as e:
        # Unexpected (non yt-dlp) error — keep the diagnostic behind the flag too.
        body = {"error": "internal error", "videoId": video_id}
        if DEBUG_DETAIL:
            body["detail"] = str(e)
        await _respond(send, 500, body)
        return

    if result is None:
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
