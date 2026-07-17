"use client";

import { useState } from "react";
import { useProfile } from "@/hooks/use-db";
import { db } from "@/lib/db";
import { getCostSummary, clearCostHistory, type CostSummary } from "@/lib/cost-tracker";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const CEFR_LEVELS = ["A2", "B1", "B2", "C1"] as const;
const DAILY_GOAL_STORAGE_KEY = "en-tutor-daily-goal";
const DEFAULT_DAILY_GOAL_MINUTES = 20;

const loadDailyGoal = (): number => {
  if (typeof window === "undefined") return DEFAULT_DAILY_GOAL_MINUTES;
  const raw = window.localStorage.getItem(DAILY_GOAL_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_GOAL_MINUTES;
};

const SettingsPage = () => {
  const profile = useProfile();
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");

  const [cefrLevelOverride, setCefrLevelOverride] = useState<string | null>(null);
  const selectedCefrLevel = cefrLevelOverride ?? profile?.initialCefrLevel ?? "";
  const [isSavingCefr, setIsSavingCefr] = useState(false);
  const [cefrSaveMessage, setCefrSaveMessage] = useState("");

  const [dailyGoal, setDailyGoal] = useState<number>(() => loadDailyGoal());
  const [isClearingData, setIsClearingData] = useState(false);

  const [costSummary, setCostSummary] = useState<CostSummary>(() => getCostSummary());

  const handleClearCostHistory = () => {
    clearCostHistory();
    setCostSummary(getCostSummary());
  };

  const handleSaveCefrLevel = async () => {
    if (!selectedCefrLevel) return;
    setIsSavingCefr(true);
    setCefrSaveMessage("");
    try {
      await db.learningProfile.update("singleton", {
        initialCefrLevel: selectedCefrLevel,
      });
      setCefrSaveMessage("Saved");
    } catch (e) {
      setCefrSaveMessage(
        `Failed to save: ${e instanceof Error ? e.message : "Unknown error"}`
      );
    } finally {
      setIsSavingCefr(false);
    }
  };

  const handleDailyGoalChange = (value: string) => {
    const parsed = Number(value);
    const nextGoal = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_GOAL_MINUTES;
    setDailyGoal(nextGoal);
    window.localStorage.setItem(DAILY_GOAL_STORAGE_KEY, String(nextGoal));
  };

  const handleClearAllData = async () => {
    setIsClearingData(true);
    try {
      await db.delete();
      window.localStorage.clear();
      window.location.reload();
    } catch (e) {
      setIsClearingData(false);
      // eslint-disable-next-line no-console
      console.error("Failed to clear data", e);
    }
  };

  const handleTestApi = async () => {
    setTestStatus("testing");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Say hello in one word." }],
          system: "Respond in one word only.",
        }),
      });
      if (res.ok) {
        setTestStatus("success");
        setTestMessage("API connection successful");
      } else {
        setTestStatus("error");
        setTestMessage(`API error: ${res.status}`);
      }
    } catch (e) {
      setTestStatus("error");
      setTestMessage(
        `Connection failed: ${e instanceof Error ? e.message : "Unknown error"}`
      );
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>AI Configuration</CardTitle>
          <CardDescription>
            API key is configured via environment variable (.env.local).
            Use the test button to verify the connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Button onClick={handleTestApi} disabled={testStatus === "testing"}>
              {testStatus === "testing" ? "Testing..." : "Test API Connection"}
            </Button>
            {testMessage && (
              <span
                className={
                  testStatus === "success"
                    ? "text-sm text-green-600"
                    : "text-sm text-red-600"
                }
              >
                {testMessage}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Learning Profile</CardTitle>
          <CardDescription>
            Your current learning configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>CEFR Level</Label>
            <div className="flex items-center gap-2">
              <Select value={selectedCefrLevel} onValueChange={(value) => value && setCefrLevelOverride(value)}>
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CEFR_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleSaveCefrLevel}
                disabled={isSavingCefr || !selectedCefrLevel}
              >
                {isSavingCefr ? "Saving..." : "Save"}
              </Button>
            </div>
            {cefrSaveMessage && (
              <span
                className={
                  cefrSaveMessage === "Saved"
                    ? "text-sm text-green-600"
                    : "text-sm text-red-600"
                }
              >
                {cefrSaveMessage}
              </span>
            )}
          </div>
          <div className="grid gap-2">
            <Label>Known Words (Base)</Label>
            <Input
              value={
                profile?.knownWordsBase
                  ? `${profile.knownWordsBase.length} words`
                  : "Not set"
              }
              disabled
              className="max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily Goal</CardTitle>
          <CardDescription>
            Target study minutes per day. Used by the study engine to plan sessions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="daily-goal-input">Minutes per day</Label>
            <Input
              id="daily-goal-input"
              type="number"
              min={1}
              value={dailyGoal}
              onChange={(e) => handleDailyGoalChange(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cost Tracking</CardTitle>
          <CardDescription>
            Estimated AI usage cost, priced in A0GI (0G&apos;s native token).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center sm:max-w-sm">
            <div>
              <p className="text-lg font-semibold">
                {costSummary.todayCostA0GI.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Today (A0GI)</p>
            </div>
            <div>
              <p className="text-lg font-semibold">
                {costSummary.totalCostA0GI.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Total (A0GI)</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{costSummary.totalCalls}</p>
              <p className="text-xs text-muted-foreground">Total calls</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium">By module</p>
              {Object.keys(costSummary.byModule).length > 0 ? (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Module</th>
                        <th className="px-3 py-2 font-medium">Calls</th>
                        <th className="px-3 py-2 font-medium">Cost (A0GI)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(costSummary.byModule)
                        .sort(([, a], [, b]) => b.costA0GI - a.costA0GI)
                        .map(([module, stats]) => (
                          <tr key={module} className="border-b last:border-0">
                            <td className="px-3 py-2 capitalize">{module}</td>
                            <td className="px-3 py-2">{stats.calls}</td>
                            <td className="px-3 py-2">{stats.costA0GI.toFixed(4)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No usage recorded yet.</p>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">By model</p>
              {Object.keys(costSummary.byModel).length > 0 ? (
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 font-medium">Calls</th>
                        <th className="px-3 py-2 font-medium">Cost (A0GI)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(costSummary.byModel)
                        .sort(([, a], [, b]) => b.costA0GI - a.costA0GI)
                        .map(([model, stats]) => (
                          <tr key={model} className="border-b last:border-0">
                            <td className="px-3 py-2">{model}</td>
                            <td className="px-3 py-2">{stats.calls}</td>
                            <td className="px-3 py-2">{stats.costA0GI.toFixed(4)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No usage recorded yet.</p>
              )}
            </div>
          </div>

          <Button variant="outline" onClick={handleClearCostHistory}>
            Clear cost history
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>
            Permanently erase all local data — SRS cards, reading sessions,
            conversations, and settings. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog>
            <DialogTrigger
              render={<Button variant="destructive">Clear All Data</Button>}
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Clear all data?</DialogTitle>
                <DialogDescription>
                  This will permanently delete all your progress, including SRS
                  cards, reading sessions, conversation history, and settings.
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={() => void handleClearAllData()}
                  disabled={isClearingData}
                >
                  {isClearingData ? "Clearing..." : "Yes, clear everything"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            EnTutor v1.0 — AI-powered English learning for practical fluency.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsPage;
