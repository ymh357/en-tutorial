import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export const maxDuration = 15;

export const POST = async (req: Request): Promise<Response> => {
  const { url } = await req.json();

  if (!url || typeof url !== "string") {
    return Response.json(
      { title: "", content: "", error: "URL is required" },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

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

    // Basic English detection: check if most characters are Latin
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
