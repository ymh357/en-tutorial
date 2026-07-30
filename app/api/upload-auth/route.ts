// app/api/upload-auth/route.ts
// Server-side @vercel/blob handleUpload route for W4-T2 client-side audio
// uploads. The browser calls upload(pathname, file, { handleUploadUrl:
// "/api/upload-auth", multipart: true, access: "public" }) — @vercel/blob
// hits this route to obtain a short-lived client token, then streams the file
// straight to Blob storage (multipart bypasses the Vercel 4.5MB function-body
// limit; the audio bytes never pass through this route). BLOB_READ_WRITE_TOKEN
// is read from the Vercel project env (already configured for the cron put).
// handleUpload/upload(client-token flow) live in the "@vercel/blob/client"
// subpath, not the package main entry.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export async function POST(request: Request): Promise<Response> {
  if (process.env.BLOB_READ_WRITE_TOKEN == null || process.env.BLOB_READ_WRITE_TOKEN === "") {
    return Response.json(
      { error: "blob storage not configured (BLOB_READ_WRITE_TOKEN missing)" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as HandleUploadBody;

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
      allowedContentTypes: [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/ogg",
        "audio/webm",
        "audio/x-m4a",
        "audio/mp4",
        "audio/aac",
        "audio/flac",
      ],
      maximumSizeInBytes: 100 * 1024 * 1024,
      addRandomSuffix: true,
    }),
  });

  return Response.json(jsonResponse);
}
