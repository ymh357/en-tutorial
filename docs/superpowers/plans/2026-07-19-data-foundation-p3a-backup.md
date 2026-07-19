# 数据地基 P3a · 导出/导入备份 + Danger Zone 加固 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供全量本地数据的导出/导入（纯本地架构下的头号必补项：清缓存/换浏览器/Safari ITP 都会永久毁掉数据），并加固 Danger Zone 清库（先导出提示 + type-to-confirm + 定向清 key + 超时兜底）。

**Architecture:** 新增 `lib/backup.ts`：`exportBackup()` 把全部 10 张 Dexie 表 + 白名单内的 `en-tutor-*` localStorage key 打包成带 `schemaVersion` 的 JSON；`downloadBackup()` 触发下载；`importBackup(file)` 校验版本后在一个 Dexie 事务里 clear+bulkPut 写回，并把 JSON 里的 ISO 字符串**还原回 Date 对象**（否则 Dexie 的 `orderBy(createdAt)`/`where(nextReview)` 会因存入 string 而失效）。Settings 加导出/导入入口并加固 Danger Zone。

**Tech Stack:** Next.js 16、React 19、TS strict、Dexie。

## Global Constraints

- TS strict；纯本地；注释英文。
- 无测试框架：验证 = `npx tsc --noEmit`（零错误）+ `npx eslint <touched files>`（不新增）+ 明确手动核对（导出→清库→导入往返，含 Date 字段与索引查询）。不起 dev server（手动核对靠推理 + 描述步骤，不实际起服务）。
- `const` 箭头函数组件。
- Git：每 task 末尾提交；用户已授权所有 git 操作，按 brief commit。commit message 末尾附：
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SDA8JvMdjpqLaxXC7gLC9M
  ```

## 本 plan 在子项目 A 中的位置

子项目 A 的 P3 拆为 **P3a（本文件，备份/Danger Zone，self-contained）** 与 **P3b（11 个 P0 bug）**。P3a 依赖 P1 的 Dexie v4（10 张表已定）。背景清单见 `/private/tmp/claude-501/-Users-minghao-en-tutorial/3f2a9528-2794-4b9e-a120-c51eeb2a51c7/scratchpad/p3-bugs.md` 的 "Backup inventory" 与 "Danger Zone" 段。

## File Structure

- `lib/backup.ts`（新）：`exportBackup` / `downloadBackup` / `importBackup` + Date 还原。
- `app/settings/page.tsx`（改）：导出/导入 UI + Danger Zone 加固。

---

## Phase 1 — `lib/backup.ts`（1 文件）

### Task 1: 备份导出/导入模块

**Files:** Create `lib/backup.ts`

**Interfaces:**
- Produces: `exportBackup(): Promise<BackupFile>`、`downloadBackup(): Promise<void>`、`importBackup(file: File): Promise<void>`、`interface BackupFile`.

- [ ] **Step 1: 写 `lib/backup.ts`**

```ts
// lib/backup.ts
// Full local-data backup: all Dexie tables + whitelisted en-tutor-* localStorage
// keys → one versioned JSON. Import clears+bulkPuts each table in a transaction
// and revives ISO date strings back into Date objects so Dexie's date indexes
// (createdAt / nextReview) keep working.
import { db } from "./db";

const SCHEMA_VERSION = 4;

// Static localStorage keys worth backing up (skip regenerable/derived ones).
const LOCAL_STATIC_KEYS = [
  "en-tutor-app",
  "en-tutor-daily-goal",
  "en-tutor-dict-history",
  "en-tutor-cost-records",
  "en-tutor-last-pool-gen",
];
// Per-id dynamic key prefixes to include.
const LOCAL_KEY_PREFIXES = [
  "en-tutor-reading-questions-",
  "en-tutor-writing-draft-",
];

// Table name → dotted paths that hold Date values (revived on import).
// Array element paths use "field[].subfield".
const DATE_PATHS: Record<string, string[]> = {
  cards: ["nextReview", "createdAt", "lastReviewedAt"],
  conversations: ["createdAt", "messages[].timestamp"],
  readingSessions: ["createdAt"],
  writingSessions: ["createdAt"],
  learningProfile: ["milestones[].earnedAt"],
  dailyStats: [],
  listeningExercises: ["createdAt"],
  translationExercises: ["createdAt"],
  poolTasks: ["createdAt"],
  assessments: [], // date is a "YYYY-MM-DD" string, not a Date
};

const TABLES = Object.keys(DATE_PATHS);

export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
  localStorage: Record<string, string>;
}

const table = (name: string) =>
  (db as unknown as Record<string, { toArray: () => Promise<unknown[]>; clear: () => Promise<void>; bulkPut: (r: unknown[]) => Promise<unknown> }>)[name];

export const exportBackup = async (): Promise<BackupFile> => {
  const tables: Record<string, unknown[]> = {};
  for (const name of TABLES) {
    tables[name] = await table(name).toArray();
  }
  const ls: Record<string, string> = {};
  if (typeof window !== "undefined") {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const keep =
        LOCAL_STATIC_KEYS.includes(key) ||
        LOCAL_KEY_PREFIXES.some((p) => key.startsWith(p));
      if (keep) ls[key] = window.localStorage.getItem(key) ?? "";
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
    localStorage: ls,
  };
};

export const downloadBackup = async (): Promise<void> => {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `entutor-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Revive one dotted date path in-place on a row.
const reviveOne = (row: Record<string, unknown>, path: string): void => {
  const arrayMatch = path.match(/^(.+)\[\]\.(.+)$/);
  if (arrayMatch) {
    const [, field, sub] = arrayMatch;
    const arr = row[field];
    if (Array.isArray(arr)) {
      for (const el of arr) {
        if (el && typeof el === "object" && (el as Record<string, unknown>)[sub] != null) {
          (el as Record<string, unknown>)[sub] = new Date((el as Record<string, unknown>)[sub] as string);
        }
      }
    }
    return;
  }
  if (row[path] != null) row[path] = new Date(row[path] as string);
};

const reviveDates = (name: string, rows: unknown[]): unknown[] => {
  const paths = DATE_PATHS[name] ?? [];
  if (paths.length === 0) return rows;
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const p of paths) reviveOne(row as Record<string, unknown>, p);
    }
  }
  return rows;
};

export const importBackup = async (file: File): Promise<void> => {
  const parsed = JSON.parse(await file.text()) as BackupFile;
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Incompatible backup (version ${parsed.schemaVersion}, this app expects ${SCHEMA_VERSION}).`
    );
  }
  await db.transaction("rw", db.tables, async () => {
    for (const name of TABLES) {
      const rows = parsed.tables?.[name];
      if (!Array.isArray(rows)) continue;
      await table(name).clear();
      await table(name).bulkPut(reviveDates(name, rows));
    }
  });
  if (typeof window !== "undefined" && parsed.localStorage) {
    for (const [k, v] of Object.entries(parsed.localStorage)) {
      window.localStorage.setItem(k, v);
    }
  }
};
```

- [ ] **Step 2:** `npx tsc --noEmit` → 无错误。`npx eslint lib/backup.ts` → 无错误。
- [ ] **Step 3: 手动核对（推理，不起 server）**
  - `DATE_PATHS` 的字段与 `lib/types.ts` 一致（cards 的 nextReview/createdAt/lastReviewedAt；conversations 的 createdAt + messages[].timestamp；learningProfile 的 milestones[].earnedAt；各 exercises/sessions/poolTasks 的 createdAt）。确认无遗漏 Date 字段（读 types.ts 核对）。
  - `assessments.date` 是 `YYYY-MM-DD` 字符串（P2c），不 revive——正确。
  - import 用 `db.transaction("rw", db.tables, ...)` 覆盖 clear+bulkPut，版本不符抛错。
- [ ] **Step 4: Commit** `feat(lib): full local backup export/import with date revival`

---

## Phase 2 — Settings 集成 + Danger Zone 加固（1 文件）

### Task 2: 导出/导入 UI + Danger Zone 加固

**Files:** Modify `app/settings/page.tsx`

**Interfaces consumed:** `downloadBackup`, `importBackup` from `@/lib/backup`.

- [ ] **Step 1: 导出/导入入口**
  加一个 "Data" 区块（或并入现有 Danger Zone 上方）：
  - "Export all data" 按钮 → `await downloadBackup()`（try/catch，失败给可见错误）。
  - "Import backup" → 隐藏 `<input type="file" accept="application/json">`，选文件后二次确认（"This will overwrite all current data"），确认则 `await importBackup(file)` → 成功后 reload；失败（版本不符/解析错）给明确错误文案，不半写。

- [ ] **Step 2: Danger Zone 加固**
  现状（`app/settings/page.tsx` clear 流程）：`db.delete()` + `window.localStorage.clear()` + reload，仅普通 confirm。改为：
  - 先提示"建议先导出备份"（可放一个指向导出的按钮/文案）。
  - **type-to-confirm**：要求用户输入指定词（如 `DELETE`）才启用确认按钮。
  - **定向清理**：`localStorage.clear()` 会连非本应用的键一起清——改为只删 `en-tutor-*` 前缀的键（遍历 `localStorage`，删以 `en-tutor-` 开头的）。
  - **超时兜底**：`db.delete()` 在其它标签页占用连接时会挂起——用 `Promise.race([db.delete(), timeout(8000)])`，超时给"请关闭本应用的其它标签页后重试"的提示，不永久卡在 "Clearing..."。

- [ ] **Step 3:** `npx tsc --noEmit` → 无错误。`npx eslint app/settings/page.tsx` → 无新错误。
- [ ] **Step 4: 手动核对（推理）**：导出→（模拟）清库→导入往返数据完整，Date 字段还原后 `db.cards.orderBy("createdAt")` 等仍可用；Danger Zone 需输入确认词、只清 en-tutor-* 键、超时有提示。
- [ ] **Step 5: Commit** `feat(settings): backup export/import UI + hardened Danger Zone`

---

## Self-Review（已执行）

- **Spec 覆盖**：spec §6（导出/导入 + Danger Zone 加固）——Task 1（backup 模块，含 spec 未细化但必需的 Date 还原）、Task 2（UI + type-to-confirm + 先导出 + 定向清 + 超时）。
- **占位符扫描**：backup.ts 给完整代码；settings 集成给明确规格（UI 元素、确认流程、加固点）+ 验收。
- **类型/清单一致性**：`TABLES`/`DATE_PATHS` 覆盖 lib/db.ts v4 的 10 张表；localStorage 白名单来自 p3-bugs.md 的 grep 清单（静态 + 前缀）；`assessments.date` 作为字符串不 revive，与 P2c 一致。
- **风险**：`db.tables` 事务覆盖全部表；导入前二次确认避免误覆盖；`schemaVersion` 不符直接拒绝（未来 v5 需升级路径，本轮只支持同版本导入）。session 级键（`en-tutor-session-<date>`、`en-tutor-assessment-progress`）不纳入备份（临时/派生），已在白名单外——有意。
