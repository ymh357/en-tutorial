import { NextResponse } from "next/server";
import { extractBvid, resolveCid, biliHeaders } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bvid = new URL(req.url).searchParams.get("bvid");
  if (!bvid) return NextResponse.json({ error: "bvid required" }, { status: 400 });
  const log: string[] = [];

  // 1. view → cid
  const meta = await resolveCid(bvid);
  log.push(`view: ${meta ? `cid=${meta.cid} title=${meta.title}` : "FAILED"}`);
  if (!meta) return NextResponse.json({ log }, { status: 502 });

  // 2. player/wbi/v2 → subtitle list (unsigned attempt)
  const subR = await fetch(
    `https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${meta.cid}`,
    { headers: biliHeaders() }
  );
  const subJ = await subR.json();
  const subs = subJ?.data?.subtitle?.subtitles ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- temporary probe, deleted in Task 8
  log.push(`captions: code=${subJ.code} subs=${JSON.stringify(subs.map((s: any) => s.lan))}`);

  // 3. playurl fnval=1 qn=16 → durl mp4
  const puR = await fetch(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${meta.cid}&qn=16&fnval=1&fnver=0&fourk=1`,
    { headers: biliHeaders() }
  );
  const puJ = await puR.json();
  const durl = puJ?.data?.durl ?? [];
  log.push(`playurl: code=${puJ.code} durlCount=${durl.length}`);

  // 4. stream download reachability — HEAD the mp4 with + without Referer
  if (durl[0]) {
    const streamUrl = durl[0].backup_url?.[0] ?? durl[0].url;
    for (const withRef of [true, false]) {
      try {
        const h = await fetch(streamUrl, {
          method: "HEAD",
          headers: withRef ? biliHeaders() : { "User-Agent": biliHeaders()["User-Agent"] },
          redirect: "follow",
        });
        log.push(`stream HEAD (referer=${withRef}): ${h.status} type=${h.headers.get("content-type")}`);
      } catch (e) {
        log.push(`stream HEAD (referer=${withRef}): ERR ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return NextResponse.json({ log });
}
