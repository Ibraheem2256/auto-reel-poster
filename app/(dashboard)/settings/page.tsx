"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectItem } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { LoadingState } from "@/components/ui/states";
import { TIMEZONE_OPTIONS } from "@/lib/constants";
import { Plus, X, Save, Lock, KeyRound, User, Clock, MessageSquare, Hash, Sparkles, Video, Zap, Shield, ChevronDown } from "lucide-react";

interface SettingsData {
  user: { email: string; name: string | null };
  workspace: {
    name: string;
    timezone: string;
    queueOrder: string;
    captions: { default: string; useSameEverywhere: boolean; platforms: Record<string, string> } | null;
    hashtags: { default: string[]; platforms: Record<string, string[]> } | null;
    titleMode: string;
    customTitle: string | null;
    aiEnabled: boolean;
    aiSettings: { niche?: string; audience?: string; instructions?: string } | null;
    autoEditEnabled: boolean;
    automationEnabled: boolean;
    paused: boolean;
  };
  aiConfigured: boolean;
}

export default function SettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("Asia/Karachi");
  const [queueOrder, setQueueOrder] = useState("OLDEST_FIRST");
  const [caption, setCaption] = useState("");
  const [useSame, setUseSame] = useState(true);
  const [platformCaptions, setPlatformCaptions] = useState<Record<string, string>>({});
  const [hashtagsText, setHashtagsText] = useState("");
  const [titleMode, setTitleMode] = useState("FILENAME");
  const [customTitle, setCustomTitle] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiNiche, setAiNiche] = useState("");
  const [aiAudience, setAiAudience] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [autoEditEnabled, setAutoEditEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [automation, setAutomation] = useState<{ automationEnabled: boolean; paused: boolean } | null>(null);
  const [toggling, setToggling] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const toast = useToast();

  const loadAutomation = useCallback(async () => {
    const a = await fetch("/api/automation").then((r) => r.json());
    setAutomation(a);
  }, []);

  useEffect(() => {
    loadAutomation();
  }, [loadAutomation]);

  const toggleAutomation = async (enabled: boolean, paused?: boolean) => {
    setToggling(true);
    try {
      const res = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, ...(paused !== undefined ? { paused } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update automation");
      setAutomation(body);
      toast({
        title: paused
          ? "Posting paused"
          : paused === false
            ? "Posting resumed"
            : enabled
              ? "Automation enabled"
              : "Automation disabled",
        variant: "success",
      });
    } catch (err) {
      toast({ title: "Failed to update automation", description: (err as Error).message, variant: "error" });
    } finally {
      setToggling(false);
    }
  };

  const load = useCallback(async () => {
    const d = await fetch("/api/settings").then((r) => r.json());
    setData(d);
    setName(d.user.name ?? "");
    setEmail(d.user.email ?? "");
    setTimezone(d.workspace.timezone);
    setQueueOrder(d.workspace.queueOrder);
    setCaption(d.workspace.captions?.default ?? "");
    setUseSame(d.workspace.captions?.useSameEverywhere ?? true);
    setPlatformCaptions(d.workspace.captions?.platforms ?? {});
    setHashtagsText((d.workspace.hashtags?.default ?? []).join(" "));
    setTitleMode(d.workspace.titleMode);
    setCustomTitle(d.workspace.customTitle ?? "");
    setAiEnabled(d.workspace.aiEnabled);
    const aiSet = d.workspace.aiSettings || {};
    setAiNiche(aiSet.niche ?? "");
    setAiAudience(aiSet.audience ?? "");
    setAiInstructions(aiSet.instructions ?? "");
    setAutoEditEnabled(d.workspace.autoEditEnabled);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (fields: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save");
      toast({ title: "Settings saved", variant: "success" });
      load();
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "New password must be at least 6 characters.", variant: "error" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", description: "Please confirm your new password correctly.", variant: "error" });
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to update password");
      toast({ title: "Password changed successfully", variant: "success" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast({ title: "Failed to change password", description: (err as Error).message, variant: "error" });
    } finally {
      setSavingPassword(false);
    }
  };

  if (!data) return <LoadingState />;

  const hashtagList = hashtagsText
    .split(/\s+/)
    .map((h) => h.replace(/^#/, ""))
    .filter(Boolean);

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Manage your profile, login credentials, and automation preferences." />

      {/* Account Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <User className="h-3.5 w-3.5" />
          Account
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile & Login ID</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </div>
              <div className="space-y-2">
                <Label>User ID / Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your-email@example.com"
                />
                <p className="text-xs text-muted-foreground">Used as your login identifier and account email.</p>
              </div>
              <Button onClick={() => save({ name, email })} disabled={saving}>
                <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving..." : "Save profile & email"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" /> Change Password
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="curr-pass">Current Password</Label>
                  <Input
                    id="curr-pass"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-pass">New Password</Label>
                  <Input
                    id="new-pass"
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="conf-pass">Confirm New Password</Label>
                  <Input
                    id="conf-pass"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" disabled={savingPassword}>
                  <Lock className="h-4 w-4 mr-1.5" /> {savingPassword ? "Updating..." : "Update password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Posting Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Posting Preferences
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timezone & Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select value={timezone} onValueChange={(v) => save({ timezone: v })}>
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">All times are stored in UTC and displayed in this timezone.</p>
              </div>
              <div className="space-y-2">
                <Label>Queue order</Label>
                <Select value={queueOrder} onValueChange={(v) => save({ queueOrder: v })}>
                  <SelectItem value="OLDEST_FIRST">Oldest first</SelectItem>
                  <SelectItem value="NEWEST_FIRST">Newest first</SelectItem>
                  <SelectItem value="RANDOM">Random</SelectItem>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">YouTube Title</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Title mode</Label>
                <Select value={titleMode} onValueChange={(v) => { setTitleMode(v); save({ titleMode: v }); }}>
                  <SelectItem value="FILENAME">Filename as title</SelectItem>
                  <SelectItem value="CUSTOM">Custom template</SelectItem>
                  <SelectItem value="AI">AI generated</SelectItem>
                </Select>
              </div>
              {titleMode === "CUSTOM" && (
                <div className="space-y-2">
                  <Label>Custom title template</Label>
                  <Input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="My reel: {filename}" />
                  <p className="text-xs text-muted-foreground">Use {"{filename}"} as a placeholder for the video file name.</p>
                  <Button onClick={() => save({ customTitle })} disabled={saving}>
                    <Save className="h-4 w-4" /> Save title
                  </Button>
                </div>
              )}
              {titleMode === "AI" && (
                <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${data.aiConfigured ? "border border-emerald-400/20 bg-emerald-500/5 text-emerald-300" : "border border-amber-400/20 bg-amber-500/5 text-amber-300"}`}>
                  <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    {data.aiConfigured
                      ? "Titles, captions, hashtags and descriptions will be generated from the actual video content with AI when videos are queued."
                      : "AI is not configured (AI_API_KEY missing). Filenames will be used instead."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Content Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          Content
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Captions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Use same caption everywhere</Label>
                  <p className="text-xs text-muted-foreground">Otherwise you can set a caption per platform.</p>
                </div>
                <Switch checked={useSame} onCheckedChange={(v) => { setUseSame(v); save({ captions: { default: caption, useSameEverywhere: v, platforms: platformCaptions } }); }} />
              </div>
              <div className="space-y-2">
                <Label>Default caption</Label>
                <Textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Enter your default caption..." />
              </div>
              {!useSame && (
                <div className="space-y-3">
                  {(["TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK"] as const).map((p) => (
                    <div key={p} className="space-y-1.5">
                      <Label className="text-xs">{p}</Label>
                      <Textarea rows={2} value={platformCaptions[p] ?? ""} onChange={(e) => setPlatformCaptions((prev) => ({ ...prev, [p]: e.target.value }))} />
                    </div>
                  ))}
                </div>
              )}
              <Button
                onClick={() => save({ captions: { default: caption, useSameEverywhere: useSame, platforms: platformCaptions } })}
                disabled={saving}
              >
                <Save className="h-4 w-4" /> Save captions
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Hash className="h-4 w-4 text-primary" /> Hashtags
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Default hashtags</Label>
                <Textarea rows={3} value={hashtagsText} onChange={(e) => setHashtagsText(e.target.value)} placeholder="#motivation #success #shorts" />
                <p className="text-xs text-muted-foreground">Space-separated. Applied to every platform (platform-specific lists can be added later).</p>
              </div>
              {hashtagList.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {hashtagList.map((h) => (
                    <span key={h} className="rounded-full bg-gradient-to-r from-brand-violet/20 to-brand-fuchsia/20 px-2.5 py-0.5 text-xs font-medium text-brand-fuchsia">
                      #{h}
                    </span>
                  ))}
                </div>
              )}
              <Button onClick={() => save({ hashtags: { default: hashtagList, platforms: {} } })} disabled={saving}>
                <Save className="h-4 w-4" /> Save hashtags
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Automation Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          Automation
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Optional AI</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable AI content generation</Label>
                  <p className="text-xs text-muted-foreground">
                    Analyzes each video's content (frames from Drive) and writes viral-optimized captions, hashtags, titles
                    and descriptions. Fully optional — the core system works without it.
                  </p>
                </div>
                <Switch
                  checked={aiEnabled}
                  disabled={!data.aiConfigured}
                  onCheckedChange={(v) => {
                    setAiEnabled(v);
                    save({ aiEnabled: v });
                  }}
                />
              </div>
              {!data.aiConfigured && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-300">
                  <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>Add AI_API_KEY to your environment to enable AI features.</p>
                </div>
              )}
              {data.aiConfigured && aiEnabled && (
                <div className="space-y-4 border-t border-white/[0.06] pt-4">
                  <div className="space-y-2">
                    <Label>Target Niche</Label>
                    <Input
                      placeholder="e.g. Finance, Tech, Comedy, Motivation, Health"
                      value={aiNiche}
                      onChange={(e) => setAiNiche(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">This helps AI optimize titles and captions for your specific topic.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Target Audience</Label>
                    <Input
                      placeholder="e.g. software developers, college students, gym goers"
                      value={aiAudience}
                      onChange={(e) => setAiAudience(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Who is this video for? The AI will use tone and references that fit them.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Custom Instructions / Tone Guidelines</Label>
                    <Textarea
                      rows={4}
                      placeholder="e.g. Write in Roman Urdu. Keep hooks highly emotional. Use emojis strategically and keep sentences short."
                      value={aiInstructions}
                      onChange={(e) => setAiInstructions(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Instruct the AI on specific rules, languages, structure or forbidden words.</p>
                  </div>
                  <Button
                    onClick={() => save({ aiSettings: { niche: aiNiche, audience: aiAudience, instructions: aiInstructions } })}
                    disabled={saving}
                  >
                    <Save className="h-4 w-4 mr-1.5" /> Save AI settings
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Video className="h-4 w-4 text-primary" /> Auto-edit videos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Edit before posting</Label>
                  <p className="text-xs text-muted-foreground">
                    Auto-edits every video before upload: 9:16 crop, hook title overlay, zoom-in intro, fade in/out,
                    loudness-normalized audio and a CC0 background track from the music library.
                  </p>
                </div>
                <Switch
                  checked={autoEditEnabled}
                  onCheckedChange={(v) => {
                    setAutoEditEnabled(v);
                    save({ autoEditEnabled: v });
                  }}
                />
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-muted-foreground">
                Drop royalty-free .mp3/.wav files into the <code className="rounded bg-muted px-1 text-foreground">music</code> folder to
                expand the background library (10 CC0 tracks included). If editing fails, the original video is published
                instead.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auto Posting</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable automation</Label>
                  <p className="text-xs text-muted-foreground">
                    Detect new Drive videos and publish them on your schedule automatically.
                  </p>
                </div>
                <Switch
                  checked={automation?.automationEnabled ?? false}
                  disabled={toggling}
                  onCheckedChange={(v) => toggleAutomation(v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Pause all posting</Label>
                  <p className="text-xs text-muted-foreground">
                    Stops new jobs instantly without losing your queue or connections.
                  </p>
                </div>
                <Switch
                  checked={automation?.paused ?? false}
                  disabled={toggling}
                  onCheckedChange={(v) => toggleAutomation(automation?.automationEnabled ?? false, v)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" /> Security & Billing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-4">
                <div>
                  <p className="font-medium">Current Plan</p>
                  <p className="text-xs text-muted-foreground">Free tier — no video storage, no VPS required.</p>
                </div>
                <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">
                  FREE
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                OAuth tokens are encrypted at rest with your NEXTAUTH_SECRET. Passwords are never stored for social platforms.
                All connections use official platform APIs.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}