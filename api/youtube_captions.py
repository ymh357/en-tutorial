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
import re

import yt_dlp

VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")


def fetch_captions(video_id):
    """Download English subtitles as json3 via yt-dlp, return normalized rows.

    yt-dlp writes one file per sub-lang to its cwd; we read the first available
    English variant. json3's POT handling is what makes this work where a bare
    fetch of the signed baseUrl returns an empty body.
    """
    opts = {
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["en", "en-orig"],
        "skip_download": True,
        "subtitlesformat": "json3",
        # Vercel serverless cwd is read-only; write the .json3 under /tmp.
        "outtmpl": "/tmp/yt-caption-%(title)s.%(ext)s",
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)

    subs = info.get("subtitles", {}) or {}
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
        with open(filepath, "r", encoding="utf-8") as f:
            events = json.load(f).get("events", [])
        sentences = _flatten_events(events)
        if sentences:
            return {"languageCode": lang, "sentences": sentences}
    return None


def _flatten_events(events):
    out = []
    for ev in events:
        start = ev.get("tStartMs")
        if start is None:
            continue
        text = "".join(seg.get("utf8", "") for seg in ev.get("segs", []))
        text = text.replace("\n", " ").strip()
        # Skip YouTube's non-speech markers ([Music], [Applause], ♪♪♪).
        if not text or text.startswith("[") or text.startswith("("):
            continue
        dur = ev.get("dDurationMs", 0)
        out.append({"text": text, "startMs": start, "endMs": start + (dur or 0)})
    return out


def _query_param(scope, name):
    raw = scope.get("query_string", b"")
    if not raw:
        return None
    for pair in raw.decode().split("&"):
        key, _, val = pair.partition("=")
        if key == name:
            return val
    return None


async def app(scope, receive, send):
    """Minimal ASGI app: GET ?v=VIDEOID -> caption JSON."""
    if scope["type"] != "http" or scope.get("method") != "GET":
        await _respond(send, 405, {"error": "GET only"})
        return

    video_id = _query_param(scope, "v") or _query_param(scope, "id")
    if not video_id or not VIDEO_ID_RE.match(video_id):
        await _respond(send, 400, {"error": "valid 11-char videoId required (v= or id=)"})
        return

    try:
        result = fetch_captions(video_id)
    except Exception as e:  # surface failure mode (429 / POT / runtime) for diagnostics
        await _respond(
            send,
            500,
            {"error": "yt-dlp threw", "videoId": video_id, "detail": str(e)},
        )
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
            "sentenceCount": len(result["sentences"]),
            "sample": result["sentences"][:3],
            "sentences": result["sentences"],
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
