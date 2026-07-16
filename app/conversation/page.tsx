"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Shuffle, PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useConversations } from "@/hooks/use-db";
import {
  SCENARIOS,
  CATEGORIES,
  getRandomScenario,
  type ScenarioDefinition,
} from "@/lib/scenarios";

const DIFFICULTY_COLOR: Record<string, string> = {
  B1: "bg-green-100 text-green-800",
  B2: "bg-blue-100 text-blue-800",
  C1: "bg-purple-100 text-purple-800",
};

const ScenarioCard = ({
  scenario,
  onClick,
}: {
  scenario: ScenarioDefinition;
  onClick: () => void;
}) => (
  <Card
    className="cursor-pointer transition-colors hover:border-primary/50"
    onClick={onClick}
  >
    <CardHeader className="py-3 px-4">
      <div className="flex items-center justify-between">
        <CardTitle className="text-sm font-medium">{scenario.name}</CardTitle>
        <Badge variant="secondary" className={DIFFICULTY_COLOR[scenario.difficulty]}>
          {scenario.difficulty}
        </Badge>
      </div>
      <CardDescription className="text-xs line-clamp-2">
        {scenario.description}
      </CardDescription>
    </CardHeader>
  </Card>
);

const ConversationPage = () => {
  const router = useRouter();
  const recentConversations = useConversations(5);
  const [customScenario, setCustomScenario] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const startConversation = (scenarioId: string, type: string) => {
    const id = crypto.randomUUID();
    router.push(`/conversation/${id}?scenario=${encodeURIComponent(scenarioId)}&type=${type}`);
  };

  const handleQuickStart = () => {
    const scenario = getRandomScenario();
    startConversation(scenario.id, "preset");
  };

  const handleFreeChat = () => {
    const id = crypto.randomUUID();
    router.push(`/conversation/${id}?type=free`);
  };

  const handleCustomScenario = () => {
    if (!customScenario.trim()) return;
    const id = crypto.randomUUID();
    router.push(
      `/conversation/${id}?scenario=${encodeURIComponent(customScenario.trim())}&type=custom`
    );
  };

  const filteredScenarios =
    activeCategory === "all"
      ? SCENARIOS
      : SCENARIOS.filter((s) => s.category === activeCategory);

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">Conversation Practice</h1>
        <p className="text-muted-foreground">
          Practice English through real-world conversation scenarios with AI.
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex flex-col sm:grid sm:grid-cols-2 gap-4">
        <Button
          size="lg"
          className="h-auto py-4 flex flex-col items-start gap-1 min-h-[44px]"
          onClick={handleQuickStart}
        >
          <div className="flex items-center gap-2">
            <Shuffle className="h-5 w-5" />
            <span className="font-semibold">Quick Start</span>
          </div>
          <span className="text-xs opacity-80 font-normal">
            Jump into a random scenario
          </span>
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-auto py-4 flex flex-col items-start gap-1 min-h-[44px]"
          onClick={handleFreeChat}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <span className="font-semibold">Free Chat</span>
          </div>
          <span className="text-xs opacity-80 font-normal">
            Talk about anything you want
          </span>
        </Button>
      </div>

      {/* Custom scenario */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          Custom Scenario
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Textarea
            placeholder="Describe a situation you want to practice (e.g., 'I need to complain about a defective product at a store')..."
            value={customScenario}
            onChange={(e) => setCustomScenario(e.target.value)}
            className="min-h-[60px] resize-none"
          />
          <Button
            onClick={handleCustomScenario}
            disabled={!customScenario.trim()}
            className="shrink-0 min-h-[44px] w-full sm:w-auto"
          >
            <PenLine className="h-4 w-4 mr-1" />
            Start
          </Button>
        </div>
      </div>

      {/* Scenario library */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Scenario Library</h2>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={activeCategory === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveCategory("all")}
          >
            All
          </Button>
          {CATEGORIES.map((cat) => (
            <Button
              key={cat.key}
              variant={activeCategory === cat.key ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory(cat.key)}
            >
              {cat.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredScenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              onClick={() => startConversation(scenario.id, "preset")}
            />
          ))}
        </div>
      </div>

      {/* Recent conversations */}
      {recentConversations.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Recent Conversations</h2>
          <div className="space-y-2">
            {recentConversations.map((conv) => (
              <Link
                key={conv.id}
                href={
                  conv.review
                    ? `/conversation/${conv.id}/review`
                    : `/conversation/${conv.id}`
                }
                className="block"
              >
                <Card className="hover:border-primary/50 transition-colors">
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {conv.scenario || "Free Chat"}
                      </CardTitle>
                      <span className="text-xs text-muted-foreground">
                        {new Date(conv.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <CardDescription className="text-xs">
                      {conv.messages.length} messages
                      {conv.review ? " — Review available" : ""}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversationPage;
