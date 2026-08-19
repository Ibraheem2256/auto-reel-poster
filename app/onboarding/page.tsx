"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { ToastProvider } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";
import { Select, SelectItem } from "@/components/ui/select";
import { TIMEZONE_OPTIONS } from "@/lib/constants";
import { FolderOpen, Link2, Clock, Zap, Check, ArrowRight } from "lucide-react";

const STEPS = [
  { title: "Connect Drive", icon: FolderOpen },
  { title: "Connect accounts", icon: Link2 },
  { title: "Set schedule", icon: Clock },
  { title: "Enable automation", icon: Zap },
];

export default function OnboardingPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [folderLink, setFolderLink] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Karachi");
  const [postsPerDay, setPostsPerDay] = useState(3);
  const [times, setTimes] = useState(["10:00", "14:00", "19:00"]);
  const [platforms, setPlatforms] = useState(["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Skip steps that are already done.
    fetch("/api/drive/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.connected) setStep((s) => Math.max(s, 1));
      })
      .catch(() => {});
  }, []);

  const connectDrive = async () => {
    setConnecting(true);
    const res = await fetch("/api/drive/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderLink }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: "Connection failed", description: data.error, variant: "error" });
      setConnecting(false);
      return;
    }
    window.location.href = data.url;
  };

  const createScheduleAndEnable = async () => {
    setSaving(true);
    const scheduleRes = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Daily schedule",
        timezone,
        scheduleType: "BEST_TIMES",
        postsPerDay,
        times: [],
        platforms,
        enabled: true,
      }),
    });
    if (!scheduleRes.ok) {
      toast({ title: "Could not create schedule", variant: "error" });
      setSaving(false);
      return;
    }
    await fetch("/api/automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    toast({ title: "Automation enabled", variant: "success" });
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <ToastProvider>
      <div className="min-h-screen bg-muted/20 px-4 py-10">
        <div className="mx-auto max-w-lg">
          <div className="mb-8 flex items-center justify-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Zap className="h-4 w-4" />
            </span>
            <span className="text-lg font-bold">Auto Reel Poster</span>
          </div>

          <div className="mb-6 flex items-center justify-between">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold ${
                      i < step
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : i === step
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {i < step ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className="hidden text-[10px] text-muted-foreground sm:block">{s.title}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`mx-1 mb-4 h-px flex-1 ${i < step ? "bg-emerald-500" : "bg-border"}`} />}
              </div>
            ))}
          </div>

          <Card>
            <CardContent className="p-6">
              {step === 0 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">Connect your Google Drive folder</h2>
                  <p className="text-sm text-muted-foreground">
                    Paste a link to the folder containing your reels. Auto Reel Poster will detect new videos and publish
                    them for you — you never upload videos to this site.
                  </p>
                  <div className="space-y-2">
                    <Label>Folder link</Label>
                    <Input
                      placeholder="https://drive.google.com/drive/folders/XXXXXXXX"
                      value={folderLink}
                      onChange={(e) => setFolderLink(e.target.value)}
                    />
                  </div>
                  <Button className="w-full" onClick={connectDrive} disabled={connecting || !folderLink}>
                    <FolderOpen className="h-4 w-4" />
                    {connecting ? "Redirecting to Google..." : "Connect folder"}
                  </Button>
                  <button
                    className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => setStep(1)}
                  >
                    I have already connected it — skip
                  </button>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">Connect social accounts</h2>
                  <p className="text-sm text-muted-foreground">
                    Go to Connected Accounts to connect TikTok, YouTube, Instagram and Facebook using official OAuth.
                  </p>
                  <Link href="/accounts" className="block">
                    <Button className="w-full">
                      <Link2 className="h-4 w-4" /> Open Connected Accounts
                    </Button>
                  </Link>
                  <button
                    className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => setStep(2)}
                  >
                    I will connect them later — continue
                  </button>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">Choose your posting schedule</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Timezone</Label>
                      <Select value={timezone} onValueChange={setTimezone}>
                        {TIMEZONE_OPTIONS.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz}
                          </SelectItem>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Posts per day</Label>
                      <Input
                        type="number"
                        min={1}
                        max={24}
                        value={postsPerDay}
                        onChange={(e) => setPostsPerDay(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
                      />
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="text-sm text-muted-foreground">
                      Times are picked automatically at each platform's peak audience hours (e.g. TikTok 6–10pm, Instagram
                      11am–2pm &amp; 7–9pm) in your timezone. No manual timing needed.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Platforms</Label>
                    <div className="flex flex-wrap gap-2">
                      {(["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() =>
                            setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
                          }
                          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                            platforms.includes(p) ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button className="w-full" onClick={() => setStep(3)}>
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">Enable automation</h2>
                  <p className="text-sm text-muted-foreground">
                    When enabled, Auto Reel Poster scans your Drive folder, queues new videos, schedules them at your
                    chosen times and publishes them automatically.
                  </p>
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <p className="font-medium">Summary</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      <li>· {postsPerDay} posts per day at {times.join(", ")} ({timezone})</li>
                      <li>· Platforms: {platforms.join(", ")}</li>
                    </ul>
                  </div>
                  <Button className="w-full" onClick={createScheduleAndEnable} disabled={saving}>
                    <Zap className="h-4 w-4" />
                    {saving ? "Setting up..." : "Enable automation & finish"}
                  </Button>
                  <Link href="/dashboard" className="block text-center text-sm text-muted-foreground hover:text-foreground">
                    Do this later
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ToastProvider>
  );
}