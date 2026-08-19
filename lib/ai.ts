import { logger } from "@/lib/logger";

/**
 * Optional AI content generation. Core system never depends on this.
 * Uses any OpenAI-compatible endpoint (OpenAI, Groq, Together, local, ...).
 */

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

interface AiRequest {
  system: string;
  user: string;
  maxTokens?: number;
  images?: { mimeType: string; base64: string }[];
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function complete(req: AiRequest, attempt = 0): Promise<string> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.AI_MODEL ?? "gpt-4o-mini";
  if (!apiKey) throw new Error("AI is not configured (AI_API_KEY missing).");

  const userContent: unknown = req.images?.length
    ? [
        { type: "text", text: req.user },
        ...req.images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
        })),
      ]
    : req.user;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: userContent },
      ],
      max_tokens: req.maxTokens ?? 300,
      temperature: 0.8,
    }),
  });

  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfter = res.headers.get("retry-after");
    const delayMs = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : BASE_DELAY_MS * Math.pow(2, attempt);
    logger.warn("ai_rate_limited", { attempt: attempt + 1, delayMs });
    await new Promise((r) => setTimeout(r, delayMs));
    return complete(req, attempt + 1);
  }

  if (!res.ok) {
    logger.error("ai_request_failed", { status: res.status, attempt: attempt + 1 });
    throw new Error("AI generation failed.");
  }
  const data = await res.json().catch(() => null);
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function generateCaption(opts: {
  fileName: string;
  durationMs?: number | null;
  topics?: string[];
}): Promise<string> {
  return complete({
    system:
      "You write short, punchy social-media captions for vertical short-form videos. No hashtags. Under 200 characters. One caption only.",
    user: `Video file: ${opts.fileName}${opts.durationMs ? `, ${Math.round((opts.durationMs ?? 0) / 1000)}s long` : ""}. Write the caption.`,
    maxTokens: 120,
  });
}

export async function generateHashtags(opts: { fileName: string; count?: number }): Promise<string[]> {
  const count = opts.count ?? 8;
  const text = await complete({
    system: `Return exactly ${count} hashtags for a short-form video, space-separated, lowercase, no explanation.`,
    user: `Video file: ${opts.fileName}`,
    maxTokens: 60,
  });
  return text
    .split(/\s+/)
    .map((t) => t.replace(/^#/, ""))
    .filter(Boolean)
    .slice(0, count);
}

export async function generateYouTubeTitle(opts: {
  fileName: string;
  durationMs?: number | null;
}): Promise<string> {
  return complete({
    system:
      "Write one engaging YouTube title (max 70 chars) for a vertical Shorts video. No clickbait, no emoji spam. Title only.",
    user: `Video file: ${opts.fileName}${opts.durationMs ? `, ${Math.round((opts.durationMs ?? 0) / 1000)}s long` : ""}.`,
    maxTokens: 60,
  });
}

export async function generateDescription(opts: { fileName: string }): Promise<string> {
  return complete({
    system: "Write a 2-3 sentence YouTube description for a Short. No hashtags. Plain text.",
    user: `Video file: ${opts.fileName}`,
    maxTokens: 150,
  });
}

export interface CaptionLine {
  text: string;
  emphasis: string[];
}

/**
 * Generate 2-4 short, punchy caption lines (Shorts style) with the keywords
 * that deserve visual emphasis. Returns [] when AI is unavailable so the
 * caller can fall back to its heuristics.
 */
export async function generateCaptionLines(opts: {
  fileName: string;
  hookText?: string;
  topic?: string;
  style?: string;
  videoType?: string;
}): Promise<CaptionLine[]> {
  if (!aiConfigured()) return [];
  try {
    const text = await complete({
      system:
        "You write on-screen caption lines for vertical short-form videos (YouTube Shorts / TikTok / Reels). " +
        "Return STRICT JSON: {\"lines\":[{\"text\":\"short punchy line\",\"emphasis\":[\"KEYWORD\"]}]}. " +
        "Rules: 2-4 lines max. Each line under 8 words. No punctuation spam. Lines must be in order. " +
        "Emphasis: 1-2 short keywords per line that deserve a bigger highlight (the payoff words). " +
        "Write for fast reading — viewers glance at captions for ~1 second. No markdown, no extra text.",
      user: `Video: ${opts.fileName}${
        opts.hookText ? `. Hook/title: ${opts.hookText}` : ""
      }${opts.topic ? `. Topic: ${opts.topic}` : ""}${
        opts.style ? `. Style: ${opts.style}` : ""
      }${opts.videoType ? `. Format: ${opts.videoType}` : ""}. Generate the caption lines.`,
      maxTokens: 220,
    });
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return [];
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as { lines?: { text?: string; emphasis?: string[] }[] };
    return (parsed.lines ?? [])
      .map((l) => ({
        text: String(l.text ?? "").trim().slice(0, 44),
        emphasis: Array.isArray(l.emphasis)
          ? (l.emphasis as unknown[])
              .filter((e): e is string => typeof e === "string")
              .map((e) => e.trim().toUpperCase().slice(0, 16))
              .filter(Boolean)
              .slice(0, 2)
          : [],
      }))
      .filter((l) => l.text.length > 0)
      .slice(0, 4);
  } catch {
    return [];
  }
}

export interface VideoAnalysis {
  topic: string;
  audience: string;
  visualNotes: string;
  style: string;
  hook: string;
}

/**
 * Pulls the first JSON object out of a model response, tolerating markdown
 * code fences and surrounding prose (free models often wrap output).
 */
function extractJson(text: string): string {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found in AI response.");
  return cleaned.slice(start, end + 1);
}

/**
 * Vision-based analysis of extracted video frames. Returns structured facts
 * about the actual video content so captions/titles are never random.
 */
export async function analyzeVideoFrames(opts: {
  fileName: string;
  durationMs?: number | null;
  frames: { mimeType: string; base64: string }[];
}): Promise<VideoAnalysis> {
  const text = await complete({
    system:
      "You are a viral short-video strategist. Analyze the video frames and return STRICT JSON with exactly these keys: " +
      '{"topic","audience","visualNotes","style","hook"}. ' +
      "topic: what the video is actually about (from the visuals). " +
      "audience: who would enjoy it. visualNotes: what is visibly happening in the frames. " +
      "style: tone/format (e.g. POV, tutorial, vlog, comedy, fitness). hook: the single strongest opening hook idea for the first 2 seconds. No markdown, no extra text.",
    user: `Video file: ${opts.fileName}${
      opts.durationMs ? `, ${Math.round((opts.durationMs ?? 0) / 1000)}s long` : ""
    }. Analyze these frames from the video.`,
    maxTokens: 400,
    images: opts.frames,
  });

  const parsed = JSON.parse(extractJson(text)) as Partial<VideoAnalysis>;
  return {
    topic: parsed.topic ?? "",
    audience: parsed.audience ?? "",
    visualNotes: parsed.visualNotes ?? "",
    style: parsed.style ?? "",
    hook: parsed.hook ?? "",
  };
}

/**
 * Generate viral-optimized content for the actual video, using the vision
 * analysis. If the vision analysis is missing, falls back to filename-only
 * prompts (never random — the base caption/hashtags are still used).
 */
export async function generateViralContent(opts: {
  fileName: string;
  durationMs?: number | null;
  analysis?: VideoAnalysis;
  platform: string;
}): Promise<{ caption: string; hashtags: string[]; title: string; description: string }> {
  const { fileName, durationMs, analysis, platform } = opts;
  const context = analysis
    ? `Video topic: ${analysis.topic || "unknown"}. What happens on screen: ${
        analysis.visualNotes || "unknown"
      }. Style: ${analysis.style || "unknown"}. Target audience: ${
        analysis.audience || "general"
      }. Strongest hook: ${analysis.hook || "lead with the topic immediately"}.`
    : `Video file name: ${fileName}.`;

  const SERIAL_DELAY_MS = 1500;

  const captionRes = await complete({
    system:
      "Write one short, punchy caption for a vertical short-form video, optimized to stop the scroll. " +
      "Hook first, then curiosity, then a call to action. Under 200 characters, no hashtags, no emojis spam, no quotes around it.",
    user: `${context}\nWrite the caption.`,
    maxTokens: 150,
  }).catch(() => "");

  await new Promise((r) => setTimeout(r, SERIAL_DELAY_MS));

  const hashtagsRes = await complete({
    system:
      "Return exactly 10 hashtags for a short-form video optimized for discovery: mix 2 broad, 5 niche, 3 trending-style. " +
      "Lowercase, space-separated, no explanation, no # symbol.",
    user: `${context}\nReturn the hashtags.`,
    maxTokens: 80,
  }).catch(() => "");

  await new Promise((r) => setTimeout(r, SERIAL_DELAY_MS));

  const titleRes = await complete({
    system:
      "Write one engaging title (max 70 chars) for a vertical YouTube Short, engineered to get clicks. " +
      "Use curiosity or a strong outcome. No clickbait lies, no emoji spam. Title only.",
    user: `${context}\nWrite the title.`,
    maxTokens: 60,
  }).catch(() => "");

  await new Promise((r) => setTimeout(r, SERIAL_DELAY_MS));

  const descRes = await complete({
    system:
      "Write a 2-3 sentence description for a vertical short-form video. Summarize what's in it and tease the value. " +
      "Plain text, no hashtags.",
    user: `${context}\nWrite the description.`,
    maxTokens: 150,
  }).catch(() => "");

  const caption = captionRes.trim() ? captionRes.trim() : "";
  const hashtags =
    hashtagsRes.trim()
      ? hashtagsRes
          .split(/\s+/)
          .map((h) => h.replace(/^#/, "").trim())
          .filter(Boolean)
          .slice(0, 10)
      : [];
  const title = titleRes.trim() ? titleRes.trim() : "";
  const description = descRes.trim() ? descRes.trim() : "";

  return { caption, hashtags, title, description };
}