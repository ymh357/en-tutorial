import { NextResponse } from "next/server";
import {
  resolveCid,
  biliHeaders,
  fetchMixinKey,
  wbiSign,
  pickEnglishSubtitle,
  fetchSubtitleJson,
} from "@/lib/bilibili";
import { parseBilibili } from "@/lib/subtitle-parse";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const bvid = new URL(req.url).searchParams.get("bvid");
  if (!bvid) return NextResponse.json({ error: "bvid required" }, { status: 400 });

  const meta = await resolveCid(bvid);
  if (!meta) return NextResponse.json({ error: "video not found", bvid }, { status: 404 });

  // Try unsigned; -352 → wbi-signed retry.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Bilibili's loose JSON response shape
  let subJ: any = await (
    await fetch(`https://api.bilibili.com/x/player/wbi/v2?bvid=${bvid}&cid=${meta.cid}`, {
      headers: biliHeaders(),
    })
  ).json();
  if (subJ.code === -352) {
    const mk = await fetchMixinKey();
    const signed = wbiSign({ bvid, cid: String(meta.cid) }, mk.imgKey, mk.subKey);
    subJ = await (
      await fetch(`https://api.bilibili.com/x/player/wbi/v2?${new URLSearchParams(signed)}`, {
        headers: biliHeaders(),
      })
    ).json();
  }
  const subs = subJ?.data?.subtitle?.subtitles ?? [];
  const en = pickEnglishSubtitle(subs);
  if (!en) {
    return NextResponse.json(
      { error: "该视频暂无英文字幕或被风控拦截，请手动粘贴 srt/vtt 字幕，或改用音频上传：", bvid },
      { status: 503 }
    );
  }
  const body = await fetchSubtitleJson(en);
  const sentences = parseBilibili(body);
  if (sentences.length === 0) {
    return NextResponse.json({ error: "字幕解析为空", bvid }, { status: 503 });
  }
  return NextResponse.json({ bvid, cid: meta.cid, languageCode: en.lan, sentences });
}
