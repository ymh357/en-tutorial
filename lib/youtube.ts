// Extracts an 11-character YouTube video ID from a watch/short/embed URL.
// Shared by shadowing-tab (W4-T3 Task 5) and the video import/routing paths
// (Task 6/7) so the parsing logic lives in exactly one place.
const VIDEO_ID_RE =
  /[?&]v=([a-zA-Z0-9_-]{11})|youtu\.be\/([a-zA-Z0-9_-]{11})|embed\/([a-zA-Z0-9_-]{11})/;

export const extractVideoId = (url: string | undefined): string | null => {
  if (!url) return null;
  const m = url.match(VIDEO_ID_RE);
  return (m?.[1] ?? m?.[2] ?? m?.[3]) ?? null;
};
