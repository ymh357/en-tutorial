import { list } from "@vercel/blob";
import { today as todayDate, formatDate } from "@/lib/date";

export const GET = async (): Promise<Response> => {
  // Shared local-timezone today (server TZ=Asia/Shanghai), matching the cron
  // blob path and the client's calendar day (review W3 #2).
  const today = todayDate();

  const { blobs } = await list({ prefix: `tasks/${today}` });

  if (blobs.length === 0) {
    // No pre-generated tasks for today — also check yesterday's
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDate(yesterday);
    const { blobs: yBlobs } = await list({ prefix: `tasks/${yesterdayStr}` });

    if (yBlobs.length === 0) {
      return Response.json({ tasks: [], date: today });
    }

    const res = await fetch(yBlobs[0].url);
    const tasks = await res.json();
    return Response.json({ tasks, date: yesterdayStr });
  }

  const res = await fetch(blobs[0].url);
  const tasks = await res.json();
  return Response.json({ tasks, date: today });
};
