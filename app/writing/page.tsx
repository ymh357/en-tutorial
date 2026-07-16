"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Mail,
  FileText,
  Share2,
  ClipboardList,
  Shuffle,
  PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useWritingSessions } from "@/hooks/use-db";
import type { WritingSession, WritingTaskType } from "@/lib/types";

type GuidedTask = {
  type: Exclude<WritingTaskType, "quick" | "free">;
  name: string;
  description: string;
  scaffold: string[];
  wordTarget: string;
  difficulty: "Easy" | "Medium" | "Hard";
  icon: typeof Mail;
  prompt: string;
};

const GUIDED_TASKS: GuidedTask[] = [
  {
    type: "email",
    name: "Business Email",
    description: "Write a professional email",
    scaffold: ["Greeting", "Context", "Request", "Closing"],
    wordTarget: "100-150 words",
    difficulty: "Easy",
    icon: Mail,
    prompt:
      "Write a professional business email. Include a greeting, context for why you're writing, a clear request, and a polite closing.",
  },
  {
    type: "essay",
    name: "Essay",
    description: "Write a short essay on a topic",
    scaffold: ["Thesis", "Supporting points", "Conclusion"],
    wordTarget: "200-300 words",
    difficulty: "Hard",
    icon: FileText,
    prompt:
      "Write a short essay on a topic of your choice. Structure it with a clear thesis, supporting points, and a conclusion.",
  },
  {
    type: "social",
    name: "Social Media Post",
    description: "Craft an engaging social post",
    scaffold: ["Hook", "Content", "Call to action"],
    wordTarget: "50-100 words",
    difficulty: "Easy",
    icon: Share2,
    prompt:
      "Craft an engaging social media post. Start with a hook, deliver the main content, and end with a call to action.",
  },
  {
    type: "report",
    name: "Report Summary",
    description: "Summarize findings in a report format",
    scaffold: ["Situation", "Findings", "Recommendation"],
    wordTarget: "150-200 words",
    difficulty: "Medium",
    icon: ClipboardList,
    prompt:
      "Summarize findings in a report format. Cover the situation, key findings, and a recommendation.",
  },
];

const DIFFICULTY_COLOR: Record<GuidedTask["difficulty"], string> = {
  Easy: "bg-green-100 text-green-800",
  Medium: "bg-blue-100 text-blue-800",
  Hard: "bg-purple-100 text-purple-800",
};

const TASK_TYPE_LABEL: Record<WritingTaskType, string> = {
  email: "Business Email",
  essay: "Essay",
  social: "Social Media Post",
  report: "Report Summary",
  quick: "Quick Task",
  free: "Free Writing",
};

const TRANSLATE_PROMPTS = [
  "今天的会议推迟到下午三点了，请通知所有参会人员。",
  "我想在网上买一台新电脑，但不确定应该选哪个品牌。",
  "这家餐厅的环境很好，但是菜品的口味一般。",
  "由于交通堵塞，我可能会迟到十五分钟左右。",
  "她每天早上都会去公园跑步，坚持了三年。",
  "这个项目的截止日期是下周五，我们时间不多了。",
];

const FORMALIZE_PROMPTS = [
  "Hey, can you send me that file when you get a sec?",
  "Sorry, running a bit late, be there in 10!",
  "Thanks so much, you're a lifesaver!",
  "Can't make it to the meeting tomorrow, something came up.",
  "Just checking in, did you get my last message?",
];

const CASUALIZE_PROMPTS = [
  "I would be grateful if you could provide an update at your earliest convenience.",
  "Please be advised that the meeting has been rescheduled to accommodate all attendees.",
  "We regret to inform you that your request cannot be processed at this time.",
  "I am writing to inquire about the status of my recent application.",
  "It would be much appreciated if you could review the attached document.",
];

const DESCRIBE_PROMPTS = [
  "A busy morning at a coffee shop",
  "A quiet beach at sunset",
  "A crowded train station during rush hour",
  "A garden after the rain",
  "A city street at night",
];

type QuickTask = {
  key: string;
  name: string;
  description: string;
  pool: string[];
};

const QUICK_TASKS: QuickTask[] = [
  {
    key: "translate",
    name: "Translate this sentence to English",
    description: "Translate the given Chinese sentence.",
    pool: TRANSLATE_PROMPTS,
  },
  {
    key: "formalize",
    name: "Rewrite more formally",
    description: "Make the casual sentence more formal.",
    pool: FORMALIZE_PROMPTS,
  },
  {
    key: "casualize",
    name: "Rewrite more casually",
    description: "Make the formal sentence more casual.",
    pool: CASUALIZE_PROMPTS,
  },
  {
    key: "describe",
    name: "Describe this scene in 3 sentences",
    description: "Describe the given topic in exactly three sentences.",
    pool: DESCRIBE_PROMPTS,
  },
];

const getRandomPrompt = (pool: string[]): string =>
  pool[Math.floor(Math.random() * pool.length)];

const WritingPage = () => {
  const router = useRouter();
  const recentWritings = useWritingSessions(5);

  const startGuidedTask = (task: GuidedTask): void => {
    const id = crypto.randomUUID();
    router.push(
      `/writing/${id}?type=${task.type}&prompt=${encodeURIComponent(task.prompt)}`
    );
  };

  const startQuickTask = (task: QuickTask): void => {
    const id = crypto.randomUUID();
    const prompt = getRandomPrompt(task.pool);
    router.push(`/writing/${id}?type=quick&prompt=${encodeURIComponent(prompt)}`);
  };

  const startFreeWriting = (): void => {
    const id = crypto.randomUUID();
    router.push(`/writing/${id}?type=free`);
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-2">Writing Practice</h1>
        <p className="text-muted-foreground">
          Choose a task and get AI feedback on your writing.
        </p>
      </div>

      {/* Guided tasks */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Guided Tasks</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GUIDED_TASKS.map((task) => {
            const Icon = task.icon;
            return (
              <Card
                key={task.type}
                className="cursor-pointer transition-colors hover:border-primary/50"
                onClick={() => startGuidedTask(task)}
              >
                <CardHeader className="py-3 px-4 gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-medium">
                        {task.name}
                      </CardTitle>
                    </div>
                    <Badge
                      variant="secondary"
                      className={DIFFICULTY_COLOR[task.difficulty]}
                    >
                      {task.difficulty}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    {task.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="py-0 px-4 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {task.scaffold.map((step) => (
                      <Badge key={step} variant="outline" className="text-xs">
                        {step}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Target: {task.wordTarget}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Quick tasks */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Quick Tasks</h2>
        <p className="text-sm text-muted-foreground">
          Short warm-up exercises to get started.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_TASKS.map((task) => (
            <Card
              key={task.key}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => startQuickTask(task)}
            >
              <CardHeader className="py-3 px-4 gap-1">
                <div className="flex items-center gap-2">
                  <Shuffle className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-medium">
                    {task.name}
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  {task.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>

      {/* Free writing */}
      <Button
        size="lg"
        className="w-full h-auto py-4 flex flex-col items-center gap-1"
        onClick={startFreeWriting}
      >
        <div className="flex items-center gap-2">
          <PenLine className="h-5 w-5" />
          <span className="font-semibold">Start Free Writing</span>
        </div>
        <span className="text-xs opacity-80 font-normal">
          Write about anything you want, no constraints
        </span>
      </Button>

      {/* Recent writings */}
      {recentWritings.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Recent Writings</h2>
          <div className="space-y-2">
            {recentWritings.map((session: WritingSession) => (
              <Link key={session.id} href={`/writing/${session.id}`} className="block">
                <Card className="hover:border-primary/50 transition-colors">
                  <CardHeader className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {TASK_TYPE_LABEL[session.taskType]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(session.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      {session.review && (
                        <Badge variant="secondary">
                          Score: {session.review.score}
                        </Badge>
                      )}
                    </div>
                    <CardDescription className="text-xs">
                      {session.wordCount} words
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

export default WritingPage;
