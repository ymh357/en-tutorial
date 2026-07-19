import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { fetch as safeFetch, Agent, type Response as UndiciResponse } from "undici";

export const maxDuration = 15;

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

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

interface ValidatedTarget {
  // Real URL to fetch: the hostname is preserved so TLS SNI and certificate
  // validation use the true host rather than a bare IP.
  url: string;
  // DNS-validated public IP. Pinned at the socket layer to prevent DNS rebinding
  // without breaking SNI.
  pinnedIp: string;
}

const validateUrl = async (
  raw: string
): Promise<{ ok: true; result: ValidatedTarget } | { ok: false; error: string }> => {
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

  // Literal IP host: validate it directly and pin the socket to itself.
  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) {
      return { ok: false, error: "URL not allowed" };
    }
    return { ok: true, result: { url: parsed.toString(), pinnedIp: host } };
  }

  // Hostname: resolve, reject private/loopback/link-local targets, then pin the
  // socket to the resolved IP while keeping the real hostname in the URL so TLS
  // SNI and the Host header stay correct.
  try {
    const { address } = await lookup(host);
    if (isPrivateIp(address)) {
      return { ok: false, error: "URL not allowed" };
    }
    return { ok: true, result: { url: parsed.toString(), pinnedIp: address } };
  } catch {
    return { ok: false, error: "Could not resolve hostname" };
  }
};

// Build a DNS lookup that always resolves to the already-validated IP. This pins
// the socket to that address (preventing DNS rebinding to a private IP after
// validation) while leaving the URL hostname intact for TLS SNI / certificate
// checks and the Host header.
const buildPinnedLookup = (ip: string): LookupFunction => {
  const family = isIP(ip);
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: ip, family }]);
    } else {
      callback(null, ip, family);
    }
  };
};

const readBodyWithLimit = async (
  response: UndiciResponse,
  maxBytes: number
): Promise<string> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error("Response too large");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
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

  const MAX_REDIRECTS = 5;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let dispatcher: Agent | null = null;

  try {
    let currentUrl = url;
    let response: UndiciResponse | null = null;

    // Follow redirects in a bounded loop, re-running the full SSRF validation
    // (protocol + DNS resolve + private/loopback/link-local reject) on every hop.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const validation = await validateUrl(currentUrl);
      if (!validation.ok) {
        return Response.json(
          {
            title: "",
            content: "",
            error:
              hop === 0
                ? validation.error
                : "The URL redirected to a disallowed address.",
          },
          { status: hop === 0 ? 400 : 200 }
        );
      }

      // Pin this hop's socket to its validated IP with a fresh dispatcher, while
      // keeping the real hostname in the URL so TLS SNI / cert checks succeed.
      const hopDispatcher = new Agent({
        connect: { lookup: buildPinnedLookup(validation.result.pinnedIp) },
      });
      if (dispatcher) await dispatcher.close();
      dispatcher = hopDispatcher;

      const res = await safeFetch(validation.result.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        signal: controller.signal,
        redirect: "manual",
        dispatcher,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        await res.body?.cancel();
        if (!location) {
          // A redirect with no Location is treated as a terminal (failing) response.
          response = res;
          break;
        }
        currentUrl = new URL(location, validation.result.url).toString();
        continue;
      }

      response = res;
      break;
    }

    clearTimeout(timeout);

    if (!response) {
      return Response.json(
        {
          title: "",
          content: "",
          error:
            "Too many redirects. Try pasting the final URL or the text directly.",
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

    let html: string;
    try {
      html = await readBodyWithLimit(response, MAX_RESPONSE_BYTES);
    } catch {
      return Response.json(
        {
          title: "",
          content: "",
          error: "Response too large (>5MB). Try pasting the text directly.",
        },
        { status: 200 }
      );
    }

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
  } finally {
    clearTimeout(timeout);
    if (dispatcher) {
      try {
        await dispatcher.close();
      } catch {
        // Ignore dispatcher cleanup failures.
      }
    }
  }
};
