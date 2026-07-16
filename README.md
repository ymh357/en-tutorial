# EnTutor

AI 驱动的英语实战学习工具，通过对话、阅读、写作、听力、翻译五大练习模块配合间隔重复记忆系统与智能学习引擎，帮助你在真实场景中提升英语能力。全站支持移动端响应式布局。

应用内置完整的中文使用指南，运行后访问 `/guide` 查看。

## 功能模块

- **Dashboard（仪表盘）** — 智能学习引擎一键生成每日学习计划（含推荐理由）、学习热力图、周报、词汇分布
- **Conversation（AI 对话练习）** — 20+ 预设场景 + 自定义场景，支持语音输入和 AI 朗读，对话结束后生成详细的 Session Review
- **Reader（沉浸式阅读）** — AI 生成文章 / 粘贴文本 / URL 导入，支持点击查词、难句解析、词汇覆盖率统计
- **Writing（写作练习）** — 引导任务、快速任务、自由写作，AI 逐句批改并标注错误与亮点
- **Listening（听力练习）** — 听写、听力理解、跟读三种模式，结合 TTS 朗读与语音识别评分
- **Translate（翻译练习）** — 单句、段落、情境三种模式，AI 评分、逐句标注、润色版本与备选译法
- **Review Cards（间隔重复复习）** — 基于 SM-2 算法的 SRS 系统，卡片自动来自对话、阅读、写作、听力、翻译中的生词和错误
- **Profile（学习档案）** — 词汇增长、对话评分趋势、错误模式分析、里程碑成就等数据看板
- **Assessment（月度测评）** — 阅读理解、完形填空、写作、对话四部分综合测评，自动更新 CEFR 等级
- **Settings（设置）** — AI 服务连接配置与测试
- **移动端适配** — 响应式布局，支持手机与平板浏览器访问

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript |
| UI | React 19, Tailwind CSS v4, shadcn/ui, base-ui |
| 图标 | lucide-react |
| 状态管理 | Zustand |
| 本地存储 | Dexie (IndexedDB) |
| AI 集成 | Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`)，接入 0G AI |
| 内容提取 | @mozilla/readability, linkedom |

## 快速开始

### 1. 克隆项目

```bash
git clone <repo-url>
cd en-tutorial
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

在项目根目录创建 `.env.local` 文件：

```bash
OG_API_KEY=your_0g_ai_api_key
OG_API_BASE_URL=your_0g_ai_base_url
OG_DEFAULT_MODEL=your_default_model
OG_QUALITY_MODEL=your_quality_model
```

### 4. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，首次访问会进入引导页面完成 CEFR 等级设置。

## 部署

推荐使用 [Vercel](https://vercel.com) 部署：

1. 将仓库导入 Vercel
2. 在 Vercel 项目设置中配置与 `.env.local` 对应的环境变量
3. 触发部署，Vercel 会自动执行 `npm run build`

## 项目结构

```
app/                # App Router 页面与 API 路由
  api/               # chat / review / extract 等后端接口
  conversation/      # 对话练习页面
  reader/            # 阅读页面
  writing/           # 写作页面
  listening/         # 听力练习页面
  translate/         # 翻译练习页面
  srs/               # 间隔重复复习页面
  profile/           # 学习档案页面
  assessment/        # 月度测评页面
  settings/          # 设置页面
  guide/             # 应用内使用指南
  onboarding/        # 首次设置引导
components/          # 共享组件与 shadcn/ui 组件（components/ui）
lib/                 # 数据库封装、SRS 算法、词频表、AI 调用等核心逻辑
hooks/                # 数据读写与响应式查询 hooks
stores/               # Zustand 状态store
docs/                 # 项目文档
```

## 使用指南

应用内提供完整的中文使用指南，涵盖所有功能模块的详细说明与学习建议，运行项目后访问 `/guide` 查看。
