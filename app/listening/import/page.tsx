"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { upload } from "@vercel/blob/client";
import {
  BlobAccessError,
  BlobContentTypeNotAllowedError,
  BlobFileTooLargeError,
} from "@vercel/blob";
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
import { isBilibiliLink } from "@/lib/bilibili-client";
import { TOPICS, DEFAULT_TOPIC } from "@/lib/topics";
import type { MaterialSentence } from "@/lib/types";

type Mode = "video" | "audio";

export default function ImportPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("video");

  // Shared across both modes.
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState<string>(DEFAULT_TOPIC);
  const [error, setError] = useState<string | null>(null);
  const [sentences, setSentences] = useState<MaterialSentence[] | null>(null);

  // Video mode.
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  // 503 fallback: automatic yt-dlp fetch failed (rate-limited/blocked), so the
  // user pastes srt/vtt/json3 captions by hand instead.
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // Audio mode.
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFetchCaptions = async () => {
    if (isBilibiliLink(url)) {
      setVideoId(null);
      setError(null);
      setSentences(null);
      setPasting(false);
      setIsFetching(true);
      try {
        const res = await fetch(`/api/bilibili/captions?url=${encodeURIComponent(url)}`);
        if (res.status === 503) {
          // Read the route's specific cause (no English sub / empty parse /
          // upstream 503) rather than a single hardcoded string, so an
          // empty-parse isn't misreported as "no English subtitle".
          const d = await res.json().catch(() => ({}));
          setPasting(true);
          setError(d.error || "该视频暂无英文字幕或被风控拦截，请手动粘贴 srt/vtt 字幕，或改用音频上传：");
          return;
        }
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(d.error || "抓取失败");
          return;
        }
        const data = await res.json();
        if (!data.sentences || data.sentences.length === 0) {
          setError("未解析到字幕");
          return;
        }
        setSentences(data.sentences);
      } catch {
        setError("Failed to reach the caption service. Try pasting subtitles instead.");
        setPasting(true);
      } finally {
        setIsFetching(false);
      }
      return;
    }

    const id = extractVideoId(url);
    if (!id) {
      setError("无法识别该链接（支持 YouTube 与 B站）。");
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
          "YouTube 当前限制字幕自动抓取（反爬）。请手动粘贴 srt/vtt/json3 字幕，或改用音频上传："
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

  // Parse pasted srt/vtt/json3 into sentences. Shared by video's 503 fallback
  // and audio's always-paste path (audio can't be auto-transcribed, so the
  // user always supplies subtitles with an upload).
  const parsePasted = () => {
    const parsed = parseSubtitles(pasteText);
    if (parsed.length === 0) {
      setError("未能从粘贴内容解析出字幕（支持 srt/vtt/json3）。");
      return;
    }
    setError(null);
    setSentences(parsed);
    // Hide the paste box once parsing succeeded — otherwise it stays visible
    // alongside the preview card, stacking two UI regions (deferred ⑦).
    setPasting(false);
  };

  const handleVideoStart = async () => {
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
    } catch (err) {
      // Previously this had no catch — a save failure (e.g. QuotaExceeded on
      // IndexedDB) would leave isCreating stuck true and the button spinning
      // forever with no error surfaced (deferred ⑦). Log so programming errors
      // aren't silently swallowed by the broad catch.
      console.error("saveMaterial failed", err);
      setError("保存素材失败，请重试。");
    } finally {
      setIsCreating(false);
    }
  };

  // Audio: stream the file straight to @vercel/blob via a client token from
  // /api/upload-auth (multipart bypasses the 4.5MB function-body limit), then
  // persist the blob URL as the Material sourceUrl.
  const handleAudioStart = async () => {
    if (!audioFile || !sentences) return;
    setIsUploading(true);
    try {
      const blob = await upload(
        // Sanitize the filename so a `/` or `\` in it can't create an
        // unexpected nested blob path (blob store isn't a filesystem, but the
        // path structure would be surprising). addRandomSuffix prevents
        // collisions.
        `audio/${audioFile.name.replace(/[/\\]/g, "_")}`,
        audioFile,
        {
          access: "public",
          handleUploadUrl: "/api/upload-auth",
          multipart: true,
        }
      );
      const mat = await dbHelpers.saveMaterial({
        topic,
        mediaType: "audio",
        sourceKind: "authentic",
        sourceUrl: blob.url,
        title: title.trim() || audioFile.name,
        content: "",
        sentences,
      });
      router.push(`/listening/audio/${mat.id}`);
    } catch (err) {
      console.error("audio upload/save failed", err);
      // Classify @vercel/blob failures so the user can act on the cause rather
      // than a generic "try again" (review [次要]).
      if (err instanceof BlobFileTooLargeError) {
        setError("文件超过 100MB 上限，请用更短的音频。");
      } else if (err instanceof BlobContentTypeNotAllowedError) {
        setError("该音频格式不被支持，请用 mp3/wav/m4a/ogg/webm/aac/flac。");
      } else if (err instanceof BlobAccessError) {
        setError("存储访问被拒（token 未配置或过期），请联系管理员。");
      } else {
        setError("音频上传或保存失败，请重试。");
      }
    } finally {
      setIsUploading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setSentences(null);
    setPasting(false);
    setPasteText("");
    setVideoId(null);
    setAudioFile(null);
    // Clear the URL too — otherwise video→audio→video leaves a stale URL with
    // no videoId, so the preview thumbnail never appears and the learner can't
    // tell why (review [次要]).
    setUrl("");
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Import listening material</CardTitle>
          <CardDescription>
            导入 YouTube 视频或上传音频，配字幕做逐句精听。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === "video" ? "default" : "outline"}
              size="sm"
              onClick={() => switchMode("video")}
            >
              YouTube 视频
            </Button>
            <Button
              variant={mode === "audio" ? "default" : "outline"}
              size="sm"
              onClick={() => switchMode("audio")}
            >
              音频上传
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

          {mode === "video" && (
            <div className="space-y-4">
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
              <p className="text-xs text-muted-foreground">支持 YouTube 与 B站 链接</p>

              {pasting && (
                <div className="space-y-2">
                  <Label>Paste subtitles (srt / vtt / json3)</Label>
                  <Textarea
                    rows={8}
                    placeholder="1&#10;00:00:00,000 --> 00:00:02,000&#10;Hello world"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <Button onClick={parsePasted} disabled={!pasteText.trim()}>
                    解析粘贴
                  </Button>
                </div>
              )}

              {sentences && (
                <PreviewCard
                  thumbnail={videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null}
                  title={title.trim() || "Untitled"}
                  sentences={sentences}
                  onStart={handleVideoStart}
                  starting={isCreating}
                />
              )}
            </div>
          )}

          {mode === "audio" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Audio file</Label>
                <Input
                  type="file"
                  accept=".mp3,.wav,.ogg,.webm,.m4a,.mp4,.aac,.flac,audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/aac,audio/flac"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setAudioFile(f);
                    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
                  }}
                />
                {audioFile && (
                  <p className="text-xs text-muted-foreground">
                    {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)} MB)
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Paste subtitles (srt / vtt / json3)</Label>
                <Textarea
                  rows={8}
                  placeholder="1&#10;00:00:00,000 --> 00:00:02,000&#10;Hello world"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <Button onClick={parsePasted} disabled={!pasteText.trim()}>
                  解析字幕
                </Button>
              </div>

              {sentences && (
                <PreviewCard
                  thumbnail={null}
                  title={title.trim() || audioFile?.name || "Untitled"}
                  sentences={sentences}
                  onStart={handleAudioStart}
                  starting={isUploading}
                  disabled={!audioFile}
                  disabledTooltip={!audioFile ? "请先选择音频文件" : undefined}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface PreviewCardProps {
  thumbnail: string | null;
  title: string;
  sentences: MaterialSentence[];
  onStart: () => void;
  starting: boolean;
  disabled?: boolean;
  disabledTooltip?: string;
}

const PreviewCard = ({
  thumbnail,
  title,
  sentences,
  onStart,
  starting,
  disabled,
  disabledTooltip,
}: PreviewCardProps) => (
  <div className="space-y-3 rounded-lg border p-4">
    {thumbnail && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={thumbnail} alt={title} className="mx-auto rounded-md max-w-full" />
    )}
    <div className="font-medium">{title}</div>
    <ul className="space-y-1 text-sm text-muted-foreground">
      {sentences.slice(0, 3).map((s, i) => (
        <li key={i}>{s.text}</li>
      ))}
    </ul>
    <Button
      onClick={onStart}
      disabled={starting || disabled}
      title={disabled ? disabledTooltip : undefined}
    >
      {starting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Uploading...
        </>
      ) : (
        "开始精听"
      )}
    </Button>
  </div>
);
