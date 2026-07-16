import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const maxDuration = 15;

const isPrivateIp = (ip: string): boolean => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
};

const validateUrl = async (
  raw: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are allowed" };
  }

  const host = parsed.hostname;

  if (
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "localhost"
  ) {
    return { ok: false, error: "URL not allowed" };
  }

  // Reject raw IP addresses (including decimal, hex, octal forms)
  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) {
      return { ok: false, error: "URL not allowed" };
    }
    // Even for public IPs, skip DNS check — already resolved
    return { ok: true, url: parsed.toString() };
  }

  // Resolve hostname and verify the IP is not private
  try {
    const { address } = await lookup(host);
    if (isPrivateIp(address)) {
      return { ok: false, error: "URL not allowed" };
    }
  } catch {
    return { ok: false, error: "Could not resolve hostname" };
  }

  return { ok: true, url: parsed.toString() };
};

export const POST = async (req: Request): Promise<Response> => {
  let body: { url?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { title: "", content: "", error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { url } = body;

  if (!url || typeof url !== "string") {
    return Response.json(
      { title: "", content: "", error: "URL is required" },
      { status: 400 }
    );
  }

  const validation = await validateUrl(url);
  if (!validation.ok) {
    return Response.json(
      { title: "", content: "", error: validation.error },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(validation.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: controller.signal,
      redirect: "manual",
    });

    clearTimeout(timeout);

    // Reject redirects — they can point to internal addresses
    if (response.status >= 300 && response.status < 400) {
      return Response.json(
        {
          title: "",
          content: "",
          error:
            "The URL redirected to another page. Try pasting the final URL or the text directly.",
        },
        { status: 200 }
      );
    }

    if (!response.ok) {
      return Response.json(
        { title: "", content: "", error: `Fetch failed: ${response.status}` },
        { status: 200 }
      );
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.length < 100) {
      return Response.json(
        {
          title: "",
          content: "",
          error:
            "Could not extract article content. The page may require login or be JavaScript-rendered. Try pasting the text directly.",
        },
        { status: 200 }
      );
    }

    let content = article.textContent.trim();
    const wordCount = content.split(/\s+/).length;
    let truncated = false;

    if (wordCount > 5000) {
      const words = content.split(/\s+/).slice(0, 5000);
      content = words.join(" ");
      truncated = true;
    }

    const latinChars = (content.match(/[a-zA-Z]/g) || []).length;
    const totalChars = content.replace(/\s/g, "").length;
    const isEnglish = totalChars > 0 && latinChars / totalChars > 0.7;

    return Response.json({
      title: article.title || "Untitled",
      content,
      truncated,
      isEnglish,
      wordCount: Math.min(wordCount, 5000),
      error: isEnglish
        ? null
        : "Warning: This content may not be in English.",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Request timed out (10s). Try pasting the text directly."
        : "Failed to fetch URL. Try pasting the text directly.";
    return Response.json(
      { title: "", content: "", error: message },
      { status: 200 }
    );
  }
};
