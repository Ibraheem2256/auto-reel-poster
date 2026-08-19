"use client";

import { useEffect, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/lib/constants";
import type { Platform } from "@prisma/client";
import {
  Sparkles,
  TrendingUp,
  Wand2,
  Music,
  Captions,
  Palette,
  Timer,
  Target,
} from "lucide-react";

interface EnhancementSuggestion {
  id: string;
  category: string;
  priority: string;
  title: string;
  description: string;
  autoFixable: boolean;
  estimatedImpact: string;
}

interface VideoEnhancement {
  videoId: string;
  fileName: string;
  currentScore: number;
  suggestions: EnhancementSuggestion[];
  viralContent: {
    caption: string;
    hashtags: string[];
    title: string;
    description: string;
  } | null;
  bestTimeToPost: { platform: Platform; time: string }[];
}

interface EnhancementReport {
  totalVideos: number;
  videosNeedingEnhancement: number;
  avgScore: number;
  enhancements: VideoEnhancement[];
  bulkActions: { label: string; description: string; action: string }[];
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  hook: <Target className="h-3.5 w-3.5" />,
  captions: <Captions className="h-3.5 w-3.5" />,
  color: <Palette className="h-3.5 w-3.5" />,
  audio: <Music className="h-3.5 w-3.5" />,
  pacing: <Timer className="h-3.5 w-3.5" />,
  music: <Music className="h-3.5 w-3.5" />,
  timing: <Timer className="h-3.5 w-3.5" />,
  content: <Sparkles className="h-3.5 w-3.5" />,
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "border-rose-500/20 bg-rose-500/5 text-rose-400",
  medium: "border-amber-500/20 bg-amber-500/5 text-amber-400",
  low: "border-blue-500/20 bg-blue-500/5 text-blue-400",
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/30">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium">{score}</span>
    </div>
  );
}

export default function EnhancerPage() {
  const [data, setData] = useState<EnhancementReport | null>(null);

  useEffect(() => {
    fetch("/api/enhancer")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data) return <LoadingState />;

  const totalSuggestions = data.enhancements.reduce((s, e) => s + e.suggestions.length, 0);
  const highPriority = data.enhancements.reduce(
    (s, e) => s + e.suggestions.filter((sg) => sg.priority === "high").length,
    0
  );

  return (
    <div>
      <PageHeader
        title="View Enhancer"
        description="Auto-improve your videos for maximum views and engagement."
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Videos" value={data.totalVideos} />
        <StatCard
          label="Need Enhancement"
          value={data.videosNeedingEnhancement}
          tone={data.videosNeedingEnhancement > 0 ? "warning" : "success"}
        />
        <StatCard label="Avg Score" value={`${data.avgScore}/100`} tone={data.avgScore >= 70 ? "success" : "warning"} />
        <StatCard label="Suggestions" value={totalSuggestions} tone={highPriority > 0 ? "warning" : "success"} />
      </div>

      {/* Bulk Actions */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="h-4 w-4 text-brand-fuchsia" />
            Bulk Actions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {data.bulkActions.map((action) => (
              <button
                key={action.action}
                className="group rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-all hover:border-brand-violet/30 hover:bg-brand-violet/5"
              >
                <h4 className="text-sm font-semibold group-hover:text-brand-fuchsia">{action.label}</h4>
                <p className="mt-1 text-xs text-muted-foreground">{action.description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Video Enhancements */}
      <div className="mt-6 space-y-4">
        {data.enhancements.map((enh) => (
          <Card key={enh.videoId}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="truncate">{enh.fileName}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  Score: {enh.currentScore}/100
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ScoreBar score={enh.currentScore} />

              {/* Suggestions */}
              <div className="grid gap-2 sm:grid-cols-2">
                {enh.suggestions.map((sg) => (
                  <div
                    key={sg.id}
                    className={`rounded-lg border p-3 ${PRIORITY_COLORS[sg.priority] || PRIORITY_COLORS.low}`}
                  >
                    <div className="flex items-center gap-2">
                      {CATEGORY_ICONS[sg.category] || <Sparkles className="h-3.5 w-3.5" />}
                      <span className="text-xs font-semibold">{sg.title}</span>
                      {sg.autoFixable && (
                        <span className="ml-auto rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                          Auto-fix
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] opacity-80">{sg.description}</p>
                    <p className="mt-1 text-[10px] opacity-60">Impact: {sg.estimatedImpact}</p>
                  </div>
                ))}
              </div>

              {/* Viral Content */}
              {enh.viralContent && (
                <div className="rounded-lg border border-brand-violet/20 bg-brand-violet/5 p-3">
                  <h4 className="text-xs font-semibold text-brand-fuchsia">AI Generated Content</h4>
                  {enh.viralContent.title && (
                    <p className="mt-1 text-xs"><span className="text-muted-foreground">Title:</span> {enh.viralContent.title}</p>
                  )}
                  {enh.viralContent.caption && (
                    <p className="mt-0.5 text-xs"><span className="text-muted-foreground">Caption:</span> {enh.viralContent.caption}</p>
                  )}
                  {enh.viralContent.hashtags.length > 0 && (
                    <p className="mt-0.5 text-xs">
                      <span className="text-muted-foreground">Tags:</span>{" "}
                      {enh.viralContent.hashtags.map((h) => `#${h}`).join(" ")}
                    </p>
                  )}
                </div>
              )}

              {/* Best Time */}
              <div className="flex flex-wrap gap-2">
                {enh.bestTimeToPost.map((bt) => (
                  <span
                    key={bt.platform}
                    className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: PLATFORM_COLORS[bt.platform] }} />
                    {PLATFORM_LABELS[bt.platform]}: {bt.time}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
