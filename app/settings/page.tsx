"use client";

import { useState } from "react";
import { useProfile } from "@/hooks/use-db";
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

const SettingsPage = () => {
  const profile = useProfile();
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState("");

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
            <Label>Initial CEFR Level</Label>
            <Input
              value={profile?.initialCefrLevel || "Not set"}
              disabled
              className="max-w-xs"
            />
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
