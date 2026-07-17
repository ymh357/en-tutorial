import { list } from "@vercel/blob";

export const GET = async (): Promise<Response> => {
  const today = new Date().toISOString().split("T")[0];

  const { blobs } = await list({ prefix: `tasks/${today}` });

  if (blobs.length === 0) {
    // No pre-generated tasks for today — also check yesterday's
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
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
