import type { Platform } from "@prisma/client";
import type { SocialPublisher } from "@/lib/publishers/types";
import { YouTubePublisher } from "@/lib/publishers/youtube";
import { InstagramPublisher } from "@/lib/publishers/instagram";
import { FacebookPublisher } from "@/lib/publishers/facebook";
import { TikTokPublisher } from "@/lib/publishers/tiktok";

const publishers = new Map<Platform, SocialPublisher>([
  ["YOUTUBE", new YouTubePublisher()],
  ["INSTAGRAM", new InstagramPublisher()],
  ["FACEBOOK", new FacebookPublisher()],
  ["TIKTOK", new TikTokPublisher()],
]);

export function getPublisher(platform: Platform): SocialPublisher {
  const publisher = publishers.get(platform);
  if (!publisher) throw new Error(`No publisher for platform ${platform}`);
  return publisher;
}