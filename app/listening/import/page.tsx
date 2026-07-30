"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dbHelpers } from "@/lib/db-helpers";
import { parseJson3, parseSubtitles } from "@/lib/subtitle-parse";
import { extractVideoId } from "@/lib/youtube";
import { TOPICS, DEFAULT_TOPIC } from "@/lib/topics";
import type { MaterialSentence } from "@/lib/types";

export default function ImportVideoPage() {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState<string>(DEFAULT_TOPIC);
  const [error, setError] = useState<string | null>(null);
  const [sentences, setSentences] = useState<MaterialSentence[] | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // 503 fallback: automatic yt-dlp fetch failed (rate-limited/blocked), so the
  // user pastes srt/vtt/json3 captions by hand instead.
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const handleFetchCaptions = async () => {
    const id = extractVideoId(url);
    if (!id) {
      setError("Could not find a video ID in this URL.");
      return;
    }
    setVideoId(id);
    setError(null);
    setSentences(null);
    setPasting(false);
    setIsFetching(true);
    try {
      const res = await fetch(`/api/youtube_captions?v=${id}`);
      if (res.status === 503) {
        setPasting(true);
        setError(
          "自动抓取失败（视频可能被限流）。请手动粘贴 srt/vtt 字幕："
        );
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "抓取失败");
        return;
      }
      const { json3 } = await res.json();
      const parsed = parseJson3(json3);
      if (parsed.length === 0) {
        setError("未解析到字幕");
        return;
      }
      setSentences(parsed);
    } catch {
      setError("Failed to reach the caption service. Try pasting subtitles instead.");
      setPasting(true);
    } finally {
      setIsFetching(false);
    }
  };

  const handleParsePaste = () => {
    const parsed = parseSubtitles(pasteText);
    if (parsed.length === 0) {
      setError("未能从粘贴内容解析出字幕（支持 srt/vtt/json3）。");
      return;
    }
    setError(null);
    setSentences(parsed);
  };

  const handleStart = async () => {
    if (!sentences) return;
    setIsCreating(true);
    try {
      const mat = await dbHelpers.saveMaterial({
        topic,
        mediaType: "video",
        sourceKind: "authentic",
        sourceUrl: url.trim(),
        title: title.trim() || "Untitled",
        content: "",
        sentences,
      });
      router.push(`/listening/video/${mat.id}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Import from YouTube</CardTitle>
          <CardDescription>
            Paste a YouTube link and we&apos;ll pull its captions for
            sentence-by-sentence listening practice.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFetchCaptions();
              }}
            />
            <Button
              onClick={handleFetchCaptions}
              disabled={!url.trim() || isFetching}
              className="shrink-0"
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "抓字幕"
              )}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label>Title (optional)</Label>
            <Input
              placeholder="Untitled"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Topic</Label>
            <Select value={topic} onValueChange={(value) => value && setTopic(value)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOPICS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {pasting && (
            <div className="space-y-2">
              <Label>Paste subtitles (srt / vtt / json3)</Label>
              <Textarea
                rows={8}
                placeholder="1&#10;00:00:00,000 --> 00:00:02,000&#10;Hello world"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <Button onClick={handleParsePaste} disabled={!pasteText.trim()}>
                解析粘贴
              </Button>
            </div>
          )}

          {sentences && (
            <div className="space-y-3 rounded-lg border p-4">
              {videoId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                  alt={title || "video thumbnail"}
                  className="mx-auto rounded-md max-w-full"
                />
              )}
              <div className="font-medium">{title.trim() || "Untitled"}</div>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {sentences.slice(0, 3).map((s, i) => (
                  <li key={i}>{s.text}</li>
                ))}
              </ul>
              <Button onClick={handleStart} disabled={isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  "开始精听"
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
