"use client";

import { useRef, useState } from "react";
import { useProfile } from "@/hooks/use-db";
import { db } from "@/lib/db";
import { dbHelpers } from "@/lib/db-helpers";
import { downloadBackup, importBackup } from "@/lib/backup";
import { getCostSummary, clearCostHistory, type CostSummary } from "@/lib/cost-tracker";
import { getKnownWordsForLevel, type CefrLevel } from "@/lib/frequency-list";
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
  const selectedCefrLevel = cefrLevelOverride ?? profile?.studyLevel ?? "";
  const [isSavingCefr, setIsSavingCefr] = useState(false);
  const [cefrSaveMessage, setCefrSaveMessage] = useState("");

  const [dailyGoal, setDailyGoal] = useState<number>(() => loadDailyGoal());

  const [dailyNewLimitOverride, setDailyNewLimitOverride] = useState<number | null>(null);
  const dailyNewLimit = dailyNewLimitOverride ?? profile?.dailyNewLimit ?? 20;

  const [costSummary, setCostSummary] = useState<CostSummary>(() => getCostSummary());

  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "error">("idle");
  const [exportError, setExportError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<"idle" | "importing" | "error">("idle");
  const [importError, setImportError] = useState("");

  const [isClearingData, setIsClearingData] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [clearError, setClearError] = useState("");

  const handleClearCostHistory = () => {
    clearCostHistory();
    setCostSummary(getCostSummary());
  };

  const handleSaveCefrLevel = async () => {
    if (!selectedCefrLevel) return;
    setIsSavingCefr(true);
    setCefrSaveMessage("");
    try {
      // Changing the study level must recompute knownWordsBase too, or
      // vocab coverage / isWordKnown would keep judging against the old
      // level's word list.
      const knownWordsBase = getKnownWordsForLevel(selectedCefrLevel as CefrLevel);
      const updatedCount = await db.learningProfile.update("singleton", {
        studyLevel: selectedCefrLevel,
        knownWordsBase,
      });
      if (updatedCount === 0) {
        // Table.update() is a no-op when the singleton row doesn't exist yet
        // (e.g. profile never initialized) — fall back to put() so the
        // change isn't silently dropped while still reporting "Saved".
        const currentProfile = await dbHelpers.getProfile();
        await db.learningProfile.put({
          ...currentProfile,
          studyLevel: selectedCefrLevel,
          knownWordsBase,
        });
      }
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

  const handleDailyNewLimitChange = async (value: string): Promise<void> => {
    const parsed = Number(value);
    const nextLimit = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 20;
    setDailyNewLimitOverride(nextLimit);
    const updatedCount = await db.learningProfile.update("singleton", {
      dailyNewLimit: nextLimit,
    });
    if (updatedCount === 0) {
      // Table.update() is a no-op when the singleton row doesn't exist yet —
      // fall back to put() so the change isn't silently dropped.
      const currentProfile = await dbHelpers.getProfile();
      await db.learningProfile.put({ ...currentProfile, dailyNewLimit: nextLimit });
    }
  };

  const handleExport = async () => {
    setExportStatus("exporting");
    setExportError("");
    try {
      await downloadBackup();
      setExportStatus("idle");
    } catch (e) {
      setExportStatus("error");
      setExportError(
        `Export failed: ${e instanceof Error ? e.message : "Unknown error"}`
      );
    }
  };

  const handleImportFileSelected = (file: File): void => {
    setPendingImportFile(file);
    setImportStatus("idle");
    setImportError("");
    setImportDialogOpen(true);
  };

  const handleConfirmImport = async () => {
    if (!pendingImportFile) return;
    setImportStatus("importing");
    setImportError("");
    try {
      await importBackup(pendingImportFile);
      window.location.reload();
    } catch (e) {
      setImportStatus("error");
      setImportError(
        `Import failed: ${e instanceof Error ? e.message : "Unknown error"}. No data was changed.`
      );
    }
  };

  const handleClearAllData = async () => {
    setIsClearingData(true);
    setClearError("");
    try {
      // db.delete() can hang if other tabs still hold an open connection to
      // this database — race it against a timeout so the UI never gets
      // permanently stuck on "Clearing...".
      await Promise.race([
        db.delete(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("CLEAR_TIMEOUT")), 8000)
        ),
      ]);
      // Only remove this app's own keys — localStorage.clear() would also
      // wipe any non-EnTutor keys that happen to share the browser storage.
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith("en-tutor-")) keysToRemove.push(key);
      }
      for (const key of keysToRemove) window.localStorage.removeItem(key);
      window.location.reload();
    } catch (e) {
      setIsClearingData(false);
      if (e instanceof Error && e.message === "CLEAR_TIMEOUT") {
        setClearError(
          "Clearing timed out. Close other tabs of this app and try again."
        );
      } else {
        setClearError(
          `Failed to clear data: ${e instanceof Error ? e.message : "Unknown error"}`
        );
        // eslint-disable-next-line no-console
        console.error("Failed to clear data", e);
      }
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
          <CardTitle>Daily New Cards</CardTitle>
          <CardDescription>
            Maximum new SRS cards introduced per day. Due reviews are never capped by this limit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 max-w-xs">
            <Label htmlFor="daily-new-limit-input">New cards per day</Label>
            <Input
              id="daily-new-limit-input"
              type="number"
              min={0}
              max={100}
              value={dailyNewLimit}
              onChange={(e) => void handleDailyNewLimitChange(e.target.value)}
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

      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
          <CardDescription>
            Export all your data to a JSON file, or restore from a previous
            export.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void handleExport()}
              disabled={exportStatus === "exporting"}
            >
              {exportStatus === "exporting" ? "Exporting..." : "Export all data"}
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Import backup
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleImportFileSelected(file);
              }}
            />
          </div>
          {exportStatus === "error" && (
            <p className="text-sm text-red-600">{exportError}</p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open);
          if (!open) {
            setPendingImportFile(null);
            setImportStatus("idle");
            setImportError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import backup?</DialogTitle>
            <DialogDescription>
              This will overwrite all current data with the contents of{" "}
              <strong>{pendingImportFile?.name}</strong>. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          {importStatus === "error" && (
            <p className="text-sm text-red-600">{importError}</p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => void handleConfirmImport()}
              disabled={importStatus === "importing"}
            >
              {importStatus === "importing"
                ? "Importing..."
                : "Yes, overwrite with backup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>
            Permanently erase all local data — SRS cards, reading sessions,
            conversations, and settings. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            We recommend exporting a backup first —{" "}
            <Button
              variant="link"
              className="h-auto p-0 text-sm"
              onClick={() => void handleExport()}
            >
              export all data
            </Button>{" "}
            before continuing.
          </p>
          {exportStatus === "error" && (
            <p className="mb-3 text-sm text-red-600">{exportError}</p>
          )}
          <Dialog
            open={clearDialogOpen}
            onOpenChange={(open) => {
              setClearDialogOpen(open);
              if (!open) {
                setDeleteConfirmText("");
                setClearError("");
              }
            }}
          >
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
              <div className="grid gap-2">
                <Label htmlFor="delete-confirm-input">
                  Type <span className="font-mono font-semibold">DELETE</span>{" "}
                  to confirm
                </Label>
                <Input
                  id="delete-confirm-input"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </div>
              {clearError && (
                <p className="text-sm text-red-600">{clearError}</p>
              )}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={() => void handleClearAllData()}
                  disabled={isClearingData || deleteConfirmText !== "DELETE"}
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
