import { NextResponse } from "next/server";
import { resolveBvid, resolveCid, biliHeaders, fetchMixinKey, wbiSign } from "@/lib/bilibili";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const bvid = await resolveBvid(url);
  if (!bvid) return NextResponse.json({ error: "video not found", url }, { status: 404 });

  const meta = await resolveCid(bvid);
  if (!meta) return NextResponse.json({ error: "video not found", url }, { status: 404 });

  try {
    // qn=16 (360P, highest quality available unsigned/without login per Task 1
    // probe) + fnval=1 (mp4/durl, not DASH). Try unsigned; -352 → wbi-signed retry.
    const base = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${meta.cid}&qn=16&fnval=1&fnver=0&fourk=1`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bilibili's loose JSON response shape
    let puJ: any = await (await fetch(base, { headers: biliHeaders() })).json();
    if (puJ.code === -352) {
      const mk = await fetchMixinKey();
      const signed = wbiSign(
        { bvid, cid: String(meta.cid), qn: "16", fnval: "1", fnver: "0", fourk: "1" },
        mk.imgKey,
        mk.subKey
      );
      puJ = await (
        await fetch(`https://api.bilibili.com/x/player/playurl?${new URLSearchParams(signed)}`, {
          headers: biliHeaders(),
        })
      ).json();
    }
    const durl = puJ?.data?.durl;
    if (!Array.isArray(durl) || !durl[0]) {
      return NextResponse.json(
        { error: "无法解析视频流（可能需登录或被风控）", bvid },
        { status: 503 }
      );
    }
    // Prefer backup_url[0] (standard upos-sz-mirror* CDN host) over base_url,
    // which can be a region/ISP-specific custom host that may not resolve for
    // any given client.
    const mediaUrl = durl[0].backup_url?.[0] ?? durl[0].url;
    return NextResponse.json({ url: mediaUrl, cid: meta.cid });
  } catch {
    // Upstream network failure / non-JSON risk-control interstitial — surface
    // a 503 (not a bare 500) so the player's onError can re-resolve or degrade.
    return NextResponse.json(
      { error: "视频流暂不可用（网络或风控），请稍后重试", bvid },
      { status: 503 }
    );
  }
}
