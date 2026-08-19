import { describe, expect, it } from "vitest";
import { nextSlotsForSchedule, zonedToUtc, startOfZonedDay } from "@/lib/scheduler";
import { buildCaptionFor } from "@/lib/publishers/types";
import { RETRY_BACKOFF_MINUTES, MAX_ATTEMPTS, VIDEO_LIMITS, SUPPORTED_EXTENSIONS } from "@/lib/constants";
import type { Schedule, Workspace } from "@prisma/client";

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "s1",
    workspaceId: "w1",
    name: "test",
    timezone: "UTC",
    scheduleType: "FIXED_TIMES",
    postsPerDay: 3,
    times: ["10:00", "14:00", "19:00"],
    platforms: ["YOUTUBE", "TIKTOK"],
    intervalHours: null,
    platformTimes: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Schedule;
}

describe("timezone math", () => {
  it("converts zoned time to UTC correctly", () => {
    // 2024-01-15 10:00 in Asia/Karachi (UTC+5) => 05:00 UTC
    const utc = zonedToUtc(2024, 1, 15, 10, 0, "Asia/Karachi");
    expect(utc.toISOString()).toBe("2024-01-15T05:00:00.000Z");
  });

  it("handles DST transitions (America/New_York)", () => {
    // 2024-03-10 02:30 is skipped by DST; result should still be a valid instant.
    const utc = zonedToUtc(2024, 3, 10, 2, 30, "America/New_York");
    expect(Number.isNaN(utc.getTime())).toBe(false);
  });

  it("startOfZonedDay returns midnight in the given zone", () => {
    const day = startOfZonedDay(new Date("2024-06-01T20:00:00Z"), "Asia/Karachi");
    expect(day.toISOString()).toBe("2024-06-01T19:00:00.000Z"); // midnight PKT (Jun 2) = 19:00 UTC
  });
});

describe("schedule slots", () => {
  it("generates fixed-time slots on the right days", async () => {
    const schedule = makeSchedule();
    const after = new Date("2024-01-01T00:00:00Z");
    const slots = await nextSlotsForSchedule(schedule, after, 4);
    expect(slots).toHaveLength(4);
    // Slot 1: Jan 1 10:00 UTC (day of start)
    expect(slots[0].toISOString()).toBe("2024-01-01T10:00:00.000Z");
    expect(slots[1].toISOString()).toBe("2024-01-01T14:00:00.000Z");
    // Slot 4 falls on Jan 2 at 10:00
    expect(slots[3].toISOString()).toBe("2024-01-02T10:00:00.000Z");
  });

  it("never returns slots in the past", async () => {
    const schedule = makeSchedule({ times: ["01:00", "02:00"] });
    const after = new Date("2024-01-01T01:30:00Z");
    const slots = await nextSlotsForSchedule(schedule, after, 3);
    for (const slot of slots) {
      expect(slot.getTime()).toBeGreaterThan(after.getTime());
    }
  });

  it("generates interval slots respecting minimum gap", async () => {
    const schedule = makeSchedule({ scheduleType: "INTERVAL", intervalHours: 4, postsPerDay: 3 });
    const slots = await nextSlotsForSchedule(schedule, new Date("2024-01-01T00:00:00Z"), 3);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].getTime() - slots[i - 1].getTime()).toBeGreaterThanOrEqual(4 * 3600_000);
    }
  });

  it("respects a non-UTC timezone for slot computation", async () => {
    const schedule = makeSchedule({ timezone: "Asia/Karachi", times: ["10:00"] });
    const slots = await nextSlotsForSchedule(schedule, new Date("2024-01-01T00:00:00Z"), 1);
    expect(slots[0].toISOString()).toBe("2024-01-01T05:00:00.000Z");
  });
});

describe("caption builder", () => {
  const workspace = {
    captions: { default: "Hello world", useSameEverywhere: true, platforms: {} },
    hashtags: { default: ["motivation", "shorts"], platforms: {} },
    titleMode: "FILENAME",
  } as unknown as Workspace;

  it("combines caption and hashtags", () => {
    const result = buildCaptionFor({
      video: { fileName: "reel001.mp4" } as never,
      workspace,
      platform: "YOUTUBE",
    });
    expect(result.caption).toContain("Hello world");
    expect(result.caption).toContain("#motivation");
    expect(result.title).toBe("reel001");
  });

  it("uses platform-specific hashtags when provided", () => {
    const ws = {
      ...workspace,
      hashtags: { default: ["a"], platforms: { TIKTOK: ["tiktokonly"] } },
    } as unknown as Workspace;
    const result = buildCaptionFor({
      video: { fileName: "reel001.mp4" } as never,
      workspace: ws,
      platform: "TIKTOK",
    });
    expect(result.hashtags).toEqual(["tiktokonly"]);
    expect(result.caption).toContain("#tiktokonly");
  });
});

describe("retry policy", () => {
  it("has increasing backoff with bounded attempts", () => {
    expect(RETRY_BACKOFF_MINUTES).toEqual([5, 30, 120]);
    expect(MAX_ATTEMPTS).toBe(RETRY_BACKOFF_MINUTES.length + 1);
  });
});

describe("video limits", () => {
  it("supports the four required extensions", () => {
    expect(SUPPORTED_EXTENSIONS.sort()).toEqual(["m4v", "mov", "mp4", "webm"]);
  });
  it("caps videos at 1 GB", () => {
    expect(VIDEO_LIMITS.maxSizeBytes).toBe(1024 * 1024 * 1024);
  });
});