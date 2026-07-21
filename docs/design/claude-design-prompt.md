# EnTutor 设计系统生成 Prompt（投喂给 Claude Design）

> 用法：把下面 `---` 分隔线之间的全部内容复制到 claude.ai/design，让它生成一套
> 设计系统。生成后回到 Claude Code，我会用 DesignSync 把结果同步进代码库。

---

# 为 EnTutor 生成一套完整设计系统

## 产品是什么

EnTutor 是一个面向**非母语英语学习者**的 AI 驱动学习平台（备考雅思、提升口语/
写作/听力/阅读）。它是一个 Web 应用，左侧 sidebar 导航，共 18 个功能页面。

## 技术底座（生成的设计系统必须落在这套体系内）

- **Tailwind CSS v4**（CSS-first 配置，没有 tailwind.config.js，token 定义在
  globals.css 的 `@theme inline` / `:root` / `.dark` 里）
- **shadcn/ui** 组件体系（Radix 基础 + class-variance-authority variants）
- **OKLCH** 颜色空间定义所有颜色 token
- **明暗双主题**：`.dark` class 变体，两套都必须提供完整 token 值
- 现有基础组件：button · card · dialog · input · label · badge · tabs ·
  sheet · sidebar · select · textarea · progress · alert · tooltip ·
  separator · scroll-area · skeleton · checkbox

## 产品调性（设计要传达的气质）

- **专业可信**：这是严肃的学习工具，不是玩具，不要幼稚化。
- **鼓励而非焦虑**：学习者会犯错，界面要让"犯错"感觉安全、被支持。
- **清爽专注**：页面承载大量文本与 AI 反馈内容，视觉必须克制、不嘈杂。
- **有节制的成就感**：连续打卡、掌握进度、完成练习要有正向激励，但克制，
  不喧宾夺主。

## 页面清单（设计需覆盖并保持跨页一致）

Dashboard · Conversation（AI 对话练习）· IELTS Part 2（口语长独白练习）·
Reader（阅读）· Writing（写作+批改）· Listening（听力/影子跟读）·
Translate（翻译）· Review Cards / SRS（间隔重复记忆卡）· Profile（学习数据）·
Roadmap（学习路径）· History · Assessment（水平测试）· Onboarding · Settings ·
Guide。

## 需要交付的设计系统内容（全部）

### 1. 品牌视觉身份
- 一套有辨识度的**调色板**替换当前 shadcn 默认灰阶（当前 `--primary` 是近黑的
  无彩色，毫无个性）。选一个能代表"成长 / 语言 / 信任"的主色，配恰当的
  secondary / accent / muted / destructive，明暗两套都要，全部用 **OKLCH**。
- **语义色**：success（练习完成/答对）、warning、info、以及"纠错"专用色
  （标记学习者错误的 original，和正确形式 corrected）。
- **排版层级**：heading / body / mono 的字号、字重、行高节奏。
- **圆角、阴影、间距**节奏，形成统一设计语言。
- 输出格式：可直接写入 `globals.css` 的 `:root` / `.dark` / `@theme inline`
  的 OKLCH token 值。

### 2. 核心组件规范（在 shadcn 组件上定制）
- Button（primary/secondary/ghost/destructive × 尺寸）、Card、Badge、Input/
  Textarea、Tabs、Dialog/Sheet、Progress、Alert、Sidebar 的视觉规范与用法。
- **"学习反馈"复合组件**（这是本产品跨多页复用的核心 UI 模式，请重点设计）：
  - 评分卡（雅思 band 分 / 0-100 子项分，含进度条/环形）
  - 纠错条目（original → corrected，配解释）
  - 高亮点评（做得好的地方）
  - 生词卡（word / 释义 / 例句 / "加入复习"按钮）
- **语音状态**组件：录音中（脉冲）、转写中、AI 思考中、播放中的视觉表达。
- **成就/进度**组件：连续打卡、掌握度、完成度徽章。

### 3. 四态统一规范
空状态 · 加载态（skeleton）· 错误态 · 成功反馈 —— 给出统一的表现模式。

### 4. 可访问性 + 响应式
- WCAG AA 对比度（明暗都达标）。
- 完整键盘可达 + 屏读语义；触控点 ≥44px。
- 移动端 → 桌面端自适应；sidebar 在移动端的折叠体验。

### 5. 动画与微交互（克制）
- 有意义的过渡：状态转场、反馈出现、成就达成、录音脉冲。
- 尊重 `prefers-reduced-motion`。动画服务于理解与愉悦，不干扰专注。

## 约束

- 不引入新 UI 框架；扩展现有 shadcn 组件体系，不重建。
- 保持明暗双主题，所有 token 明暗都给值。
- 颜色一律 OKLCH。
- 输出要能对应到具体文件：token → globals.css；组件 variant → 各 ui 组件。

## 期望产出

一套可预览的设计系统：token 表（颜色/字体/圆角/阴影/间距）+ 关键组件的高保真
样式 + "学习反馈"复合模式 + 四态规范 + 一致性用法指南。每个组件配一个可视化
预览卡，便于我后续用 DesignSync 增量同步进代码库。

---
