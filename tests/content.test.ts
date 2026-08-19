import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildContentFor, clearContentCache } from "@/lib/content";
import { clearAnalysisCache } from "@/lib/video-analysis";
import { escapeDrawText } from "@/lib/editor";
import type { Workspace } from "@prisma/client";

vi.mock("@/lib/ai", () => ({
  aiConfigured: () => true,
  analyzeVideoFrames: vi.fn(async () => ({
    topic: "cooking pasta",
    audience: "home cooks",
    visualNotes: "person boiling pasta in a kitchen",
    style: "tutorial",
    hook: "starting with the boiling water close-up",
  })),
  generateViralContent: vi.fn(async () => ({
    caption: "Pasta in 5 minutes with 3 ingredients",
    hashtags: ["pastarecipes", "5minute", "easydinner", "cooking", "shorts"],
    title: "Pasta in 5 Minutes (3 Ingredients)",
    description: "Quick pasta recipe anyone can make.",
  })),
}));

vi.mock("@/lib/video-analysis", () => ({
  analyzeVideo: vi.fn(async () => ({
    topic: "cooking pasta",
    audience: "home cooks",
    visualNotes: "person boiling pasta in a kitchen",
    style: "tutorial",
    hook: "starting with the boiling water close-up",
  })),
  clearAnalysisCache: vi.fn(),
}));

import { generateViralContent } from "@/lib/ai";
import { analyzeVideo } from "@/lib/video-analysis";

const mockedGenerateViralContent = vi.mocked(generateViralContent);
const mockedAnalyzeVideo = vi.mocked(analyzeVideo);

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    captions: { default: "Static caption", useSameEverywhere: true, platforms: {} },
    hashtags: { default: ["static"], platforms: {} },
    titleMode: "FILENAME",
    aiEnabled: true,
    customTitle: null,
    ...overrides,
  } as unknown as Workspace;
}

beforeEach(() => {
  vi.clearAllMocks();
  clearContentCache();
  clearAnalysisCache();
});

describe("buildContentFor", () => {
  it("returns static content when AI is disabled", async () => {
    const result = await buildContentFor({
      video: { fileName: "reel001.mp4" } as never,
      workspace: makeWorkspace({ aiEnabled: false }),
      platform: "YOUTUBE",
    });
    expect(result.aiGenerated).toBe(false);
    expect(result.caption).toContain("Static caption");
    expect(result.caption).toContain("#static");
    expect(mockedGenerateViralContent).not.toHaveBeenCalled();
    expect(mockedAnalyzeVideo).not.toHaveBeenCalled();
  });

  it("analyzes the video and generates content from the analysis", async () => {
    const result = await buildContentFor({
      video: { fileName: "reel001.mp4" } as never,
      workspace: makeWorkspace(),
      platform: "YOUTUBE",
    });
    expect(result.aiGenerated).toBe(true);
    expect(mockedAnalyzeVideo).toHaveBeenCalledTimes(1);
    expect(mockedGenerateViralContent).toHaveBeenCalledTimes(1);
    expect(mockedGenerateViralContent).toHaveBeenCalledWith(
      expect.objectContaining({ analysis: expect.objectContaining({ topic: "cooking pasta" }) })
    );
    expect(result.title).toBe("Pasta in 5 Minutes (3 Ingredients)");
    expect(result.caption).toContain("Pasta in 5 minutes");
    expect(result.caption).toContain("#pastarecipes");
    expect(result.hashtags).toEqual(["pastarecipes", "5minute", "easydinner", "cooking", "shorts"]);
  });

  it("caches generated content per video across platforms", async () => {
    const workspace = makeWorkspace();
    const video = { fileName: "reel001.mp4" } as never;
    await buildContentFor({ video, workspace, platform: "YOUTUBE" });
    await buildContentFor({ video, workspace, platform: "TIKTOK" });
    await buildContentFor({ video, workspace, platform: "INSTAGRAM" });
    expect(mockedAnalyzeVideo).toHaveBeenCalledTimes(1);
    expect(mockedGenerateViralContent).toHaveBeenCalledTimes(1);
  });

  it("falls back to static content when AI generation fails", async () => {
    mockedGenerateViralContent.mockRejectedValueOnce(new Error("API down"));
    const result = await buildContentFor({
      video: { fileName: "reel001.mp4" } as never,
      workspace: makeWorkspace(),
      platform: "YOUTUBE",
    });
    expect(result.caption).toContain("Static caption");
    expect(result.title).toBe("reel001");
    expect(result.aiGenerated).toBe(true);
  });

  it("falls back to filename-based generation when video analysis fails", async () => {
    mockedAnalyzeVideo.mockResolvedValueOnce(null);
    mockedGenerateViralContent.mockResolvedValueOnce({
      caption: "Generated from filename",
      hashtags: ["tiktok", "viral"],
      title: "Generated Title",
      description: "Generated description.",
    });
    const result = await buildContentFor({
      video: { fileName: "reel001.mp4" } as never,
      workspace: makeWorkspace(),
      platform: "TIKTOK",
    });
    expect(result.title).toBe("Generated Title");
    expect(mockedGenerateViralContent).toHaveBeenCalledWith(expect.objectContaining({ analysis: undefined }));
  });

  it("never overrides a custom title", async () => {
    const result = await buildContentFor({
      video: { fileName: "reel001.mp4" } as never,
      workspace: makeWorkspace({ titleMode: "CUSTOM", customTitle: "My custom {filename}" }),
      platform: "YOUTUBE",
    });
    expect(result.title).toBe("My custom reel001");
    expect(mockedGenerateViralContent).toHaveBeenCalled();
  });

  describe("escapeDrawText", () => {
    it("escapes ffmpeg filter special characters", () => {
      expect(escapeDrawText("Don't Stop: 100%")).toBe("Don\\'t Stop\\: 100\\%");
    });

    it("collapses newlines and trims long titles", () => {
      const out = escapeDrawText("Line one\nLine two " + "x".repeat(80));
      expect(out).not.toContain("\n");
      expect(out.length).toBeLessThanOrEqual(60);
    });
  });
});