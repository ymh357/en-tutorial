// app/api/upload-auth/route.ts
// Server-side @vercel/blob handleUpload route for W4-T2 client-side audio
// uploads. The browser calls upload(pathname, file, { handleUploadUrl:
// "/api/upload-auth", multipart: true, access: "public" }) — @vercel/blob
// hits this route to obtain a short-lived client token, then streams the file
// straight to Blob storage (multipart bypasses the Vercel 4.5MB function-body
// limit; the audio bytes never pass through this route). BLOB_READ_WRITE_TOKEN
// is read from the Vercel project env. handleUpload/upload (client-token flow)
// live in the "@vercel/blob/client" subpath, not the package main entry.
//
// This app is a single-user (singleton profile) client-side learning tool with
// no server-side auth/session system, so we can't gate on a login cookie. To
// prevent cross-site anonymous abuse we restrict the route to same-origin
// requests (the deployed app's own origin) — a third-party page can't call it.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

// Same-origin only — blocks cross-site callers from minting upload tokens.
// Covers the production deploy, per-commit Vercel preview deploys
// (en-tutorial-<hash>-<scope>.vercel.app), and local dev (next/vercel dev,
// including Next's auto-increment port when 3000 is taken). Preview deploys
// get a fresh origin per commit, so a static allowlist would 403 them all.
function isAllowedOrigin(origin: string): boolean {
  try {
    const { hostname, port } = new URL(origin);
    if (hostname === "localhost" && /^300[0-9]$/.test(port)) return true;
    return /^en-tutorial(-[^.]+)?\.vercel\.app$/.test(hostname);
  } catch {
    return false;
  }
}

const AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "audio/x-m4a",
  "audio/m4a",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
];

export async function POST(request: Request): Promise<Response> {
  if (process.env.BLOB_READ_WRITE_TOKEN == null || process.env.BLOB_READ_WRITE_TOKEN === "") {
    return Response.json(
      { error: "blob storage not configured (BLOB_READ_WRITE_TOKEN missing)" },
      { status: 500 }
    );
  }

  // Require the Origin header to be present AND allowed (a missing Origin is
  // treated as untrusted rather than passed through).
  const origin = request.headers.get("origin");
  if (origin == null || !isAllowedOrigin(origin)) {
    return Response.json({ error: "forbidden origin" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      // Authorize only audio content types. maximumSizeInBytes caps a single
      // upload (100 MB covers any reasonable listening clip / podcast episode).
      onBeforeGenerateToken: async (
        _pathname: string,
        _clientPayload: string | null,
        _multipart: boolean
      ) => ({
        allowedContentTypes: AUDIO_CONTENT_TYPES,
        maximumSizeInBytes: 100 * 1024 * 1024,
        addRandomSuffix: true,
      }),
    });
    return Response.json(jsonResponse);
  } catch (e) {
    // handleUpload throws on malformed body (body.type matches no union arm)
    // or on token-generation refusal — surface a clean 400 instead of a 500
    // that could leak a stack trace.
    console.error("upload-auth handleUpload failed", e);
    return Response.json({ error: "invalid upload request" }, { status: 400 });
  }
}
