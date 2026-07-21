# EnTutor Design System — Extracted Spec

> 来源：Claude Design 生成的 `EnTutor Design System.dc.html`（81KB）。
> 目标：sync 进真实项目 `/Users/minghao/en-tutorial`（Tailwind v4 + shadcn/ui + OKLCH + 明暗主题）。
> 本文档所有 OKLCH 值均从 HTML `.ds-root`（light）与 `.ds-root.dark`（dark）块逐字抄录，**不可改动**。

---

## 1. 完整 Token 表

### 1.1 颜色 / 语义 Token（明暗对照）

设计稿里 light 定义在 `.ds-root`，dark 定义在 `.ds-root.dark`。在真实项目中分别对应 `:root` 与 `.dark`。

| 变量名 | light 值 | dark 值 | 现有项目已有？ |
|---|---|---|---|
| `--background` | `oklch(0.99 0.004 190)` | `oklch(0.19 0.018 220)` | ✅ 已有（值需覆盖） |
| `--foreground` | `oklch(0.24 0.02 220)` | `oklch(0.93 0.012 195)` | ✅ 已有 |
| `--card` | `oklch(1 0 0)` | `oklch(0.225 0.02 220)` | ✅ 已有 |
| `--card-foreground` | `oklch(0.24 0.02 220)` | `oklch(0.93 0.012 195)` | ✅ 已有 |
| `--popover` | `oklch(1 0 0)` | `oklch(0.225 0.02 220)` | ✅ 已有 |
| `--popover-foreground` | `oklch(0.24 0.02 220)` | `oklch(0.93 0.012 195)` | ✅ 已有 |
| `--primary` | `oklch(0.60 0.126 172)` | `oklch(0.72 0.13 172)` | ✅ 已有 |
| `--primary-foreground` | `oklch(0.99 0.01 175)` | `oklch(0.18 0.03 210)` | ✅ 已有 |
| `--secondary` | `oklch(0.955 0.018 195)` | `oklch(0.28 0.02 210)` | ✅ 已有 |
| `--secondary-foreground` | `oklch(0.34 0.03 200)` | `oklch(0.92 0.012 195)` | ✅ 已有 |
| `--muted` | `oklch(0.965 0.008 195)` | `oklch(0.265 0.02 210)` | ✅ 已有 |
| `--muted-foreground` | `oklch(0.52 0.02 200)` | `oklch(0.68 0.02 200)` | ✅ 已有 |
| `--accent` | `oklch(0.72 0.15 48)` | `oklch(0.76 0.14 55)` | ✅ 已有 |
| `--accent-foreground` | `oklch(0.26 0.05 40)` | `oklch(0.18 0.04 45)` | ✅ 已有 |
| `--destructive` | `oklch(0.58 0.19 25)` | `oklch(0.66 0.18 25)` | ✅ 已有 |
| `--destructive-foreground` | `oklch(0.99 0.01 25)` | `oklch(0.98 0.01 25)` | ⚠️ 现有项目**没有** `--destructive-foreground`（现有 shadcn 版本靠 destructive 自带 fg），新 token 明确给出，建议补上 |
| `--success` | `oklch(0.62 0.15 155)` | `oklch(0.70 0.14 156)` | 🆕 新增 |
| `--success-foreground` | `oklch(0.99 0.01 155)` | `oklch(0.16 0.03 156)` | 🆕 新增 |
| `--warning` | `oklch(0.80 0.15 78)` | `oklch(0.82 0.14 80)` | 🆕 新增 |
| `--warning-foreground` | `oklch(0.28 0.05 80)` | `oklch(0.22 0.04 80)` | 🆕 新增 |
| `--info` | `oklch(0.60 0.13 245)` | `oklch(0.70 0.12 240)` | 🆕 新增 |
| `--info-foreground` | `oklch(0.99 0.01 245)` | `oklch(0.16 0.03 240)` | 🆕 新增 |
| `--correction-original` | `oklch(0.57 0.18 22)` | `oklch(0.74 0.15 25)` | 🆕 新增 |
| `--correction-original-bg` | `oklch(0.955 0.035 22)` | `oklch(0.30 0.06 25)` | 🆕 新增 |
| `--correction-corrected` | `oklch(0.53 0.13 158)` | `oklch(0.74 0.12 158)` | 🆕 新增 |
| `--correction-corrected-bg` | `oklch(0.955 0.04 158)` | `oklch(0.30 0.05 158)` | 🆕 新增 |
| `--border` | `oklch(0.915 0.01 200)` | `oklch(0.32 0.02 210)` | ✅ 已有 |
| `--input` | `oklch(0.915 0.01 200)` | `oklch(0.34 0.02 210)` | ✅ 已有 |
| `--ring` | `oklch(0.60 0.126 172)` | `oklch(0.72 0.13 172)` | ✅ 已有 |

**注意点**
- 设计稿**没有**定义 `sidebar-*` 全系列、`chart-1..5`。现有项目已有这些 token，sync 时**保留现有值不动**（或后续单独调色）。
- 设计稿把 dark 的 `--border`/`--input` 用**实心 OKLCH**（`0.32 / 0.34`），而现有项目 dark 用的是 `oklch(1 0 0 / 10%)` / `oklch(1 0 0 / 15%)` 半透明。采用新 token 会变成实心边框。
- 设计稿 `--radius` = `0.75rem`；现有项目 `--radius` = `0.625rem`（不同，见 §1.4）。

### 1.2 新增变量清单（需要在 `@theme inline` 里注册 `--color-*` 映射才能被 Tailwind utility 识别）

现有 `@theme inline` 里**没有**以下映射，需要补：

```
--color-success: var(--success);
--color-success-foreground: var(--success-foreground);
--color-warning: var(--warning);
--color-warning-foreground: var(--warning-foreground);
--color-info: var(--info);
--color-info-foreground: var(--info-foreground);
--color-correction-original: var(--correction-original);
--color-correction-original-bg: var(--correction-original-bg);
--color-correction-corrected: var(--correction-corrected);
--color-correction-corrected-bg: var(--correction-corrected-bg);
--color-destructive-foreground: var(--destructive-foreground);
```

> 注意：HTML 末尾自带的 `@theme inline` 块（见 §5）只映射了 `-original` 和 `-corrected` 的**前景色**，**遗漏**了 `-original-bg` / `-corrected-bg` 两个背景色和所有 `*-foreground`。若要能用 `bg-correction-original-bg` 这类 utility，必须按上面清单补全。

完整新增 CSS 变量（12 个，未含 `--destructive-foreground`；含它则 13 个）：
`--success` `--success-foreground` `--warning` `--warning-foreground` `--info` `--info-foreground` `--correction-original` `--correction-original-bg` `--correction-corrected` `--correction-corrected-bg`（+ 现有项目缺的 `--destructive-foreground`）。

### 1.3 字体

| 角色 | 字体栈 | 用途 |
|---|---|---|
| Display / heading | `'Bricolage Grotesque', system-ui, sans-serif` | 标题、Display、大数字、卡片标题 |
| Body | `'Public Sans', system-ui, sans-serif` | 正文、AI 反馈、UI 文本 |
| Mono | `'JetBrains Mono', ui-monospace, monospace` | 音标、token 值、代码、band 数值 |

设计稿变量名：`--font-display` / `--font-body` / `--font-mono`。
现有项目变量名是 `--font-sans` / `--font-mono` / `--font-heading`（`--font-heading` 目前指向 `--font-sans`）。映射建议：`--font-heading` → Bricolage，`--font-sans` → Public Sans，`--font-mono` → JetBrains Mono。

**Google Fonts import URL（`<head>` 用）：**
```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Public+Sans:ital,wght@0,400..800;1,400..600&family=JetBrains+Mono:wght@400;500;600&display=swap
```
配套 preconnect：
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

### 1.4 Radius

- 基准：`--radius: 0.75rem;`（= 12px）。**与现有项目 `0.625rem` 不同。**
- 设计稿 `@theme inline` 推荐派生（注意与现有项目的 `*0.6/*0.8` 乘法式派生不同，这里是减法式）：
  - `--radius-lg: var(--radius);`（12px）
  - `--radius-md: calc(var(--radius) - 3px);`（≈9px）
  - `--radius-sm: calc(var(--radius) - 6px);`（≈6px）
- Radius 展示台阶（实际组件用到的值）：sm=6px、md=9px、lg=12px、xl=16px。

### 1.5 Shadow（tinted elevation）

设计稿用一个 `--shadow-tint`（HSL 三元组）驱动 4 级阴影。**light 与 dark 的 tint 和 opacity 都不同。**

**Light：**
```css
--shadow-tint: 200 45% 22%;
--sh-xs: 0 1px 2px hsl(var(--shadow-tint) / 0.06);
--sh-sm: 0 1px 3px hsl(var(--shadow-tint) / 0.08), 0 1px 2px hsl(var(--shadow-tint) / 0.04);
--sh-md: 0 4px 12px hsl(var(--shadow-tint) / 0.08), 0 2px 4px hsl(var(--shadow-tint) / 0.05);
--sh-lg: 0 12px 32px hsl(var(--shadow-tint) / 0.12), 0 4px 8px hsl(var(--shadow-tint) / 0.05);
```

**Dark：**
```css
--shadow-tint: 210 50% 3%;
--sh-xs: 0 1px 2px hsl(var(--shadow-tint) / 0.4);
--sh-sm: 0 1px 3px hsl(var(--shadow-tint) / 0.5), 0 1px 2px hsl(var(--shadow-tint) / 0.3);
--sh-md: 0 4px 12px hsl(var(--shadow-tint) / 0.5), 0 2px 4px hsl(var(--shadow-tint) / 0.3);
--sh-lg: 0 12px 32px hsl(var(--shadow-tint) / 0.6), 0 4px 8px hsl(var(--shadow-tint) / 0.4);
```
> 这些是 `hsl()`，不是 OKLCH。若要经 Tailwind 暴露，用 `--shadow-xs/sm/md/lg`。现有项目未定义这套阴影，属新增。

### 1.6 Spacing（4px 基准）

无自定义变量，用 Tailwind 默认 4px 刻度。展示刻度：1=4px、2=8px、3=12px、4=16px、6=24px、8=32px、12=48px、16=64px。

---

## 2. 组件样式规范

> 通用：所有按钮/输入 `font-family: var(--font-body)`；`font-weight: 600`。过渡 `.15s`。

### 2.1 Buttons（5 variant × 3 size + icon）

**尺寸（default）：** `padding:10px 18px; font-size:14px; border-radius:10px;`

| variant | background | color | border | shadow | hover |
|---|---|---|---|---|---|
| **primary** | `var(--primary)` | `var(--primary-foreground)` | none | `--sh-xs` | `filter: brightness(1.06)` |
| **secondary** | `var(--secondary)` | `var(--secondary-foreground)` | `1px solid var(--border)` | 无 | `background: var(--muted)` |
| **outline** | `transparent` | `var(--foreground)` | `1px solid var(--border)` | 无 | `background: var(--secondary)` |
| **ghost** | `transparent` | `var(--foreground)` | none | 无 | `background: var(--secondary)` |
| **destructive** | `var(--destructive)` | `var(--destructive-foreground)` | none | `--sh-xs` | `filter: brightness(1.06)` |
| **disabled** | `var(--muted)` | `var(--muted-foreground)` | none | 无 | `cursor:not-allowed; opacity:0.7` |

**尺寸表：**
| size | font-size | padding | border-radius |
|---|---|---|---|
| sm | 12.5px | 7px 13px | 8px |
| default | 14px | 10px 18px | 10px |
| lg | 16px | 13px 26px | 12px |
| icon | — | 42×42px | 10px（内容居中） |
| with-icon | 14px | 10px 18px | 10px | `display:inline-flex; gap:8px`（图标 16px） |

> cva 建议：`primary/destructive` 用 `brightness(1.06)` hover（可用 `hover:brightness-105`）；`secondary` hover → `bg-muted`；`outline/ghost` hover → `bg-secondary`。

### 2.2 Cards & Badges

**Card（主容器）：**
- `border:1px solid var(--border); border-radius:16px; background:var(--card); box-shadow:var(--sh-sm)`（多数卡片用 `--sh-xs`，主卡片用 `--sh-sm`；反馈大卡片用 `--sh-md`）。
- Header/body/footer 共享 **22px 横向 padding**；header `padding:20px 22px 0`，body `padding:16px 22px 22px`。
- 卡内标题：`font-family:var(--font-display); font-size:18px; font-weight:700`。副标题：`13px; color:var(--muted-foreground)`。

**Muted surface（嵌套面板）：** `background:var(--secondary); border-radius:16px; padding:18px`。用于侧栏、非激活 tab 轨道、嵌套 panel。

**Badges（`border-radius:999px; font-size:11.5px; font-weight:700; padding:4px 11px`）：**
| badge | background | color | border |
|---|---|---|---|
| Primary | `var(--primary)` | `var(--primary-foreground)` | 无 |
| Secondary | `var(--secondary)` | `var(--secondary-foreground)` | `1px solid var(--border)` |
| Completed（success） | `color-mix(in oklab, var(--success) 16%, transparent)` | `var(--success)` | 无 |
| Review due（warning） | `color-mix(in oklab, var(--warning) 20%, transparent)` | `var(--warning-foreground)` | 无 |
| New（info） | `color-mix(in oklab, var(--info) 16%, transparent)` | `var(--info)` | 无 |
| Outline | `transparent` | `var(--muted-foreground)` | `1px solid var(--border)` |
| "时长" pill（卡片右上，如 "2 min"） | `color-mix(in oklab, var(--primary) 14%, transparent)` | `var(--primary)` | 无；`padding:4px 10px` |

### 2.3 Inputs & Tabs

**Input / Textarea：**
- `font-size:14px; padding:10px 13px; border-radius:10px; border:1px solid var(--input); background:var(--background); color:var(--foreground); outline:none;`
- Textarea 额外 `line-height:1.55; resize:vertical`。
- **Focus（关键）：** `border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 24%, transparent);`（即 3px ring，24% 不透明度）。
- Label：`font-size:13px; font-weight:600; margin-bottom:7px;`。

**Checkbox（勾选态）：** `20×20px; border-radius:6px; background:var(--primary)`，内含 `var(--primary-foreground)` 的 √（stroke-width 3.5）。

**Segmented Tabs：**
- 轨道容器：`display:inline-flex; padding:4px; border-radius:11px; background:var(--secondary); gap:3px`。
- Tab 项：`font-size:13px; font-weight:600; padding:7px 15px; border-radius:8px; border:none`。
- **激活态：** `background:var(--card); color:var(--foreground); box-shadow:var(--sh-xs)`（浮起到 card 面上）。
- 非激活态：`background:transparent; color:var(--muted-foreground)`；hover → `color:var(--foreground)`。
- Focus ring 用 `--ring`，2px offset。

### 2.4 Alerts & Progress

**Alert（`padding:14px 16px; border-radius:12px; display:flex; gap:12px`），三色公式：**
- 底色：`color-mix(in oklab, var(--<sem>) 10~12%, var(--card))`
- 边框：`1px solid color-mix(in oklab, var(--<sem>) 30~32%, transparent)`
- 图标 stroke：`var(--<sem>)`（原色）
- 标题：`font-weight:700; font-size:13.5px`；描述：`font-size:13px; color:var(--muted-foreground)`

| 类型 | 语义色 | 底色 mix | 边框 mix | 标题示例 |
|---|---|---|---|---|
| Tip | `--info` | 10% | 30% | "Tip" |
| Saved | `--success` | 12% | 32% | "Saved" |
| Error | `--destructive` | 10% | 30% | "Microphone blocked" |

**Progress bar（线性）：**
- 轨道：`height:9px; border-radius:999px; background:var(--muted); overflow:hidden`。
- 填充：`height:100%; border-radius:999px`。primary 型用渐变 `linear-gradient(90deg, var(--primary), oklch(0.68 0.15 190))`；accent 型用纯 `var(--accent)`。
- 入场动画：`animation: ds-grow 1s ease-out`（`@keyframes ds-grow { from { width: 0; } }`）。
- 顶部标签行：`font-size:13px; font-weight:600`，右侧百分比 `color:var(--muted-foreground)`。

**Ring progress（环形）：** SVG 88×88，`transform:rotate(-90deg)`；底环 `stroke:var(--muted); stroke-width:9`；进度环 `stroke:var(--primary); stroke-width:9; stroke-linecap:round; stroke-dasharray:238.7`（= 2πr, r=38），`stroke-dashoffset` 控制进度（示例 66.8 ≈ 72%）。中心数字 `font-family:var(--font-display); font-size:22px; font-weight:700`。

---

## 3. 新增复合组件（现有项目大概率没有，需新建）

### 3.1 Learning feedback 专区（签名模式，4 个 building block）

复用于 Conversation / IELTS / Reader / Writing / Listening。

#### (a) ScoreCard（评分卡）
结构：外层 `border-radius:18px; box-shadow:var(--sh-md); overflow:hidden`。
- **Header**：`background:linear-gradient(135deg, color-mix(in oklab, var(--primary) 12%, var(--card)), var(--card)); padding:22px 26px; display:flex; justify-content:space-between`。
  - 左：分数徽章 `64×64; border-radius:16px; background:var(--primary); color:var(--primary-foreground)`，内含大数字（`font-display; 26px; 700`）+ 小标签 "BAND"（9px, opacity 0.85）；旁边标题（`font-display; 19px; 700`）+ 副标题（`13px; muted-foreground`）。
  - 右：delta pill "+0.5 vs last" → `color-mix(in oklab, var(--success) 16%, transparent)` 底 / `var(--success)` 字。
- **Body**：`padding:22px 26px; display:grid; grid-template-columns:repeat(4,1fr); gap:20px`。每个子项：标签行（`12.5px; 600`，右侧分数 muted）+ 细进度条（`height:7px; radius:999px; bg:var(--muted)`，填充 `var(--primary)`；某维度用 `var(--accent)` 表示待提升，如 Grammar）。四维度示例：Fluency / Lexical / Grammar / Pronun.。

#### (b) CorrectionEntry（纠错条）
结构：`border-radius:16px; box-shadow:var(--sh-xs); overflow:hidden`。
- **Header 条**：`padding:10px 18px; border-bottom:1px solid var(--border); font-size:12px; font-weight:700; color:var(--muted-foreground)`；左侧 8px 圆点表示类型色（CORRECTION → `var(--correction-original)`；WORD CHOICE → `var(--warning)`）+ 大写标签。
- **Body**：`padding:16px 18px`。核心句子 `font-size:15px`：
  - 原文（错误）span：`background:var(--correction-original-bg); color:var(--correction-original); padding:2px 5px; border-radius:5px; text-decoration:line-through; text-decoration-thickness:2px`。
  - 中间箭头 SVG（→，stroke `var(--muted-foreground)`）。
  - 更正 span：`background:var(--correction-corrected-bg); color:var(--correction-corrected); padding:2px 5px; border-radius:5px; font-weight:700`。
  - 下方解释：`font-size:13px; color:var(--muted-foreground); line-height:1.55`。

> **correction-original/corrected 用法总结**：`*-bg` 只做 span 底色，`*`（前景）做文字色 + 删除线色 + 圆点色。原文永远配删除线，更正文永远加粗。

#### (c) HighlightPraise（表扬块）
结构：`border:1px solid color-mix(in oklab, var(--success) 30%, transparent); border-radius:16px; background:color-mix(in oklab, var(--success) 8%, var(--card)); padding:18px`。
- 头部：26×26 圆角方块 `background:var(--success)`，内含 star SVG（`var(--success-foreground)`）+ 标题 "Nicely done"（`font-weight:700; 13.5px; color:var(--success)`）。
- 正文 `font-size:14.5px; line-height:1.6`，被夸的短语用 inline highlight：`background:color-mix(in oklab, var(--success) 20%, transparent); padding:1px 5px; border-radius:5px; font-weight:600`。

#### (d) WordCard（单词卡）
结构：`border-radius:16px; box-shadow:var(--sh-xs); padding:18px`。
- 首行：单词（`font-display; 20px; 700`）+ 右侧音标（`font-mono; 12.5px; muted-foreground`）。
- 词性/级别行："ADJECTIVE · B2" → `font-size:11px; font-weight:700; color:var(--accent); letter-spacing:0.03em`。
- 释义：`font-size:14px; line-height:1.55`。
- 例句：`font-style:italic; color:var(--muted-foreground); padding-left:11px; border-left:2px solid var(--border)`。
- "Add to review" 按钮（全宽）：`background:color-mix(in oklab, var(--primary) 12%, transparent); color:var(--primary); border-radius:9px; padding:9px`，含 + 图标；hover → `color-mix(in oklab, var(--primary) 20%, transparent)`。

### 3.2 Voice states 专区（VoiceState，4 态）

统一卡片：`border-radius:16px; box-shadow:var(--sh-xs); padding:24px 18px; text-align:center`。中心 60×60 圆形指示器 + 标题（`14px; 700`）+ 副标题（`12px; muted-foreground`）。

| 态 | 指示器 | 动画 |
|---|---|---|
| **Recording** | 60px 圆 `background:var(--destructive)`（内含 mic 图标 `var(--destructive-foreground)`），外套一层同色 `opacity:0.35` 的脉冲环 | `ds-pulse-ring 1.8s ease-out infinite`（scale 0.9→1.7, opacity 0.7→0） |
| **Transcribing** | 60px 圆 `background:var(--secondary)`，内含 3 个 7px `var(--info)` 圆点 | `ds-dot 1.2s infinite`（延迟 0/.2/.4s，跳动） |
| **AI thinking** | 60px 圆 `background:color-mix(in oklab, var(--primary) 14%, transparent)`，内含 34px 环 `border:3px solid color-mix(...primary 30%...); border-top-color:var(--primary)` | `ds-spin .8s linear infinite` |
| **Playing** | 60px 圆 `background:var(--primary)`，内含 4 条 `3.5px` 竖条 `var(--primary-foreground)`（高度 40/70/100/60%） | `ds-eq .9s ease-in-out infinite`（延迟 0/.15/.3/.45s） |

### 3.3 Achievement & progress 专区（3 个卡片）

- **StreakCard**：`padding:20px; display:flex; align-items:center; gap:15px`。左 52×52 圆角块 `background:color-mix(in oklab, var(--accent) 16%, transparent)` 内含火焰 SVG（`fill:var(--accent)`）；右大数字 "12"（`font-display; 26px; 700`）+ "day streak"（`12.5px; muted-foreground`）。
- **WeekBars（本周热力条）**：`padding:20px`。标题 "This week"。7 根竖条 `flex:1; height:30px; border-radius:6px`：完成日 `var(--primary)`；部分 `color-mix(in oklab, var(--primary) 40%, var(--muted))`；未完成 `var(--muted)`。底部说明 "4 of 7 days · keep going"。
- **MilestoneCard**：`background:linear-gradient(135deg, color-mix(in oklab, var(--accent) 14%, var(--card)), var(--card)); padding:20px; display:flex; gap:15px`。左 54×54 圆 `background:var(--accent)` + `box-shadow:var(--sh-sm)`，内含奖章 SVG（`var(--accent-foreground)`），入场 `animation:ds-pop .5s ease-out`；右标题 "Milestone unlocked" + 描述。

---

## 4. 四态规范（Empty / Loading / Error / Success）

统一卡片：`border-radius:16px; box-shadow:var(--sh-xs); padding:28px（loading 22px）`。原则："空态邀请行动，加载用 skeleton（内容区绝不用 spinner），错误保持冷静并给出出路，成功简短确认"。

| 态 | 图标容器 | 图标色 | 文案（标题 14.5px/700 + 描述 13px/muted） | 动作按钮 |
|---|---|---|---|---|
| **Empty** | 52×52 圆角块 `background:var(--secondary)` | book SVG `var(--muted-foreground)` | "No practice yet" / "Your completed sessions will appear here." | primary 按钮 "Start first session" |
| **Loading** | — 用骨架屏 | — | 骨架：头像 44px 圆 + 两行文字条 + 3 行内容条（宽 100/92/70%） | 无 |
| **Error** | 52×52 圆角块 `background:color-mix(in oklab, var(--destructive) 12%, transparent)` | × SVG `var(--destructive)` | "Couldn't load feedback" / "Check your connection and try again." | outline 按钮 "Retry" |
| **Success** | 52×52 **圆形** `background:var(--success)`，`animation:ds-pop .5s ease-out` | √ SVG `var(--success-foreground)` | "Session complete!" / "You earned 40 XP…"；外框 `border:1px solid color-mix(in oklab, var(--success) 30%, transparent); background:color-mix(in oklab, var(--success) 8%, var(--card))` | 实心 success 按钮 "Continue"（`background:var(--success); color:var(--success-foreground)`） |

**Skeleton 样式（关键，`.ds-sk`）：**
```css
background: linear-gradient(90deg, var(--muted) 25%, color-mix(in oklab, var(--muted) 55%, var(--card)) 37%, var(--muted) 63%);
background-size: 800px 100%;
animation: ds-shimmer 1.4s linear infinite;
/* @keyframes ds-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } } */
```

---

## 5. globals.css tokens 输出块（HTML 原样提取）

HTML §13 "globals.css tokens" 提供了三个可粘贴代码块。**以下为原样抄录**（注意：`:root` / `.dark` 块是**精简版**，只列了核心变量，省略了 `-foreground`/`-bg`/popover/card-foreground/input/shadow 等；完整值请以 §1 的表为准）。

### 5.1 `:root` — light（原样）
```css
--background: oklch(0.99 0.004 190);
--foreground: oklch(0.24 0.02 220);
--card: oklch(1 0 0);
--primary: oklch(0.60 0.126 172);
--primary-foreground: oklch(0.99 0.01 175);
--secondary: oklch(0.955 0.018 195);
--muted: oklch(0.965 0.008 195);
--muted-foreground: oklch(0.52 0.02 200);
--accent: oklch(0.72 0.15 48);
--destructive: oklch(0.58 0.19 25);
--success: oklch(0.62 0.15 155);
--warning: oklch(0.80 0.15 78);
--info: oklch(0.60 0.13 245);
--correction-original: oklch(0.57 0.18 22);
--correction-corrected: oklch(0.53 0.13 158);
--border: oklch(0.915 0.01 200);
--ring: oklch(0.60 0.126 172);
--radius: 0.75rem;
```

### 5.2 `.dark`（原样）
```css
--background: oklch(0.19 0.018 220);
--foreground: oklch(0.93 0.012 195);
--card: oklch(0.225 0.02 220);
--primary: oklch(0.72 0.13 172);
--primary-foreground: oklch(0.18 0.03 210);
--secondary: oklch(0.28 0.02 210);
--muted: oklch(0.265 0.02 210);
--muted-foreground: oklch(0.68 0.02 200);
--accent: oklch(0.76 0.14 55);
--destructive: oklch(0.66 0.18 25);
--success: oklch(0.70 0.14 156);
--warning: oklch(0.82 0.14 80);
--info: oklch(0.70 0.12 240);
--correction-original: oklch(0.74 0.15 25);
--correction-corrected: oklch(0.74 0.12 158);
--border: oklch(0.32 0.02 210);
--ring: oklch(0.72 0.13 172);
```

### 5.3 `@theme inline`（原样，注意其不完整）
```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-accent: var(--accent);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-info: var(--info);
  --color-correction-original: var(--correction-original);
  --color-correction-corrected: var(--correction-corrected);
  --font-display: 'Bricolage Grotesque', sans-serif;
  --font-sans: 'Public Sans', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 3px);
  --radius-sm: calc(var(--radius) - 6px);
}
```

> ⚠️ 落地提醒：这个 `@theme inline` 块**遗漏**了 `secondary/muted/destructive/border/ring/card/...` 的 `--color-*` 映射（因为现有项目已经有了，直接沿用即可），也遗漏了 `success-foreground` / `warning-foreground` / `info-foreground` / `*-bg` / `destructive-foreground`。真正落地时以 §1.2 的补全清单为准，不要照抄这个精简块。

---

## 附：动画 keyframes 汇总（新增，需加进 globals.css）

```css
@keyframes ds-pulse-ring { 0% { transform: scale(0.9); opacity: 0.7; } 70% { transform: scale(1.7); opacity: 0; } 100% { opacity: 0; } }
@keyframes ds-spin { to { transform: rotate(360deg); } }
@keyframes ds-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
@keyframes ds-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }
@keyframes ds-eq { 0%, 100% { height: 20%; } 50% { height: 100%; } }
@keyframes ds-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
@keyframes ds-grow { from { width: 0; } }
```
配套 `@media (prefers-reduced-motion: reduce)` 关闭动画（设计稿已实现）。
```
