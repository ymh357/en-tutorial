import Link from "next/link";

const NAV_GROUPS = [
  {
    label: "开始",
    items: [
      { href: "#start", label: "快速开始" },
      { href: "#onboarding", label: "首次设置" },
      { href: "#dashboard", label: "仪表盘" },
    ],
  },
  {
    label: "核心功能",
    items: [
      { href: "#conversation", label: "AI 对话练习" },
      { href: "#reader", label: "沉浸式阅读" },
      { href: "#writing", label: "写作练习" },
      { href: "#listening", label: "听力练习" },
      { href: "#translate", label: "翻译练习" },
      { href: "#srs", label: "间隔重复复习" },
    ],
  },
  {
    label: "进阶",
    items: [
      { href: "#profile", label: "学习档案" },
      { href: "#assessment", label: "月度测评" },
      { href: "#tips", label: "高效使用建议" },
    ],
  },
];

const Tip = ({
  label,
  variant = "blue",
  children,
}: {
  label: string;
  variant?: "blue" | "green" | "amber";
  children: React.ReactNode;
}) => {
  const styles = {
    blue: "border-primary bg-primary/5 [&_.tip-label]:text-primary",
    green:
      "border-emerald-500 bg-emerald-500/10 [&_.tip-label]:text-emerald-600 dark:[&_.tip-label]:text-emerald-400",
    amber:
      "border-amber-500 bg-amber-500/10 [&_.tip-label]:text-amber-600 dark:[&_.tip-label]:text-amber-400",
  } as const;

  return (
    <div
      className={`my-4 rounded-r-lg border-l-4 p-4 text-sm ${styles[variant]}`}
    >
      <div className="tip-label mb-1 text-xs font-bold tracking-wide uppercase">
        {label}
      </div>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
};

const ModuleCard = ({
  icon,
  title,
  path,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  path: string;
  children: React.ReactNode;
}) => (
  <div className="mb-5 rounded-xl border bg-card p-4 md:p-6 shadow-sm">
    <div className="mb-3 flex items-center gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">
        {icon}
      </div>
      <div className="text-[17px] font-bold tracking-tight">{title}</div>
      <span className="ml-auto rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
        {path}
      </span>
    </div>
    <p className="text-muted-foreground">{children}</p>
  </div>
);

const StepList = ({ children }: { children: React.ReactNode }) => (
  <ol className="list-none pl-0">{children}</ol>
);

const Step = ({
  index,
  title,
  isLast,
  children,
}: {
  index: number;
  title: string;
  isLast?: boolean;
  children: React.ReactNode;
}) => (
  <li
    className={`relative ml-4 border-l-2 py-3 pl-10 ${
      isLast ? "border-transparent" : "border-border"
    }`}
  >
    <span className="absolute top-3 -left-[15px] flex h-[26px] w-[26px] items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground">
      {index}
    </span>
    <div className="mb-1 font-semibold text-foreground">{title}</div>
    <p className="text-muted-foreground">{children}</p>
  </li>
);

const FlowDiagram = ({ steps }: { steps: string[] }) => (
  <div className="my-4 flex flex-wrap items-center gap-2 text-sm">
    {steps.map((step, i) => (
      <span key={step} className="contents">
        <span className="rounded-lg border bg-card px-3.5 py-1.5 font-medium shadow-sm">
          {step}
        </span>
        {i < steps.length - 1 && (
          <span className="text-lg text-muted-foreground">&rarr;</span>
        )}
      </span>
    ))}
  </div>
);

const RatingTable = ({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) => (
  <div className="my-3 overflow-x-auto">
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          {headers.map((h) => (
            <th
              key={h}
              className="border-b px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td
                key={j}
                className={`border-b px-3 py-2 ${j === 0 ? "font-semibold" : ""}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Badge = ({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "blue" | "green" | "purple" | "amber" | "red";
}) => {
  const styles = {
    blue: "bg-primary/10 text-primary",
    green:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    purple: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    red: "bg-red-500/15 text-red-600 dark:text-red-400",
  } as const;
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[color]}`}
    >
      {children}
    </span>
  );
};

const Section = ({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) => (
  <section id={id} className="mb-12 scroll-mt-20">
    <h2 className="mb-4 border-b-2 pb-2 text-[22px] font-bold tracking-tight">
      {title}
    </h2>
    <div className="[&_h3]:mt-6 [&_h3]:mb-2.5 [&_h3]:text-[17px] [&_h3]:font-semibold [&_p]:mb-3 [&_p]:max-w-[65ch] [&_p]:text-muted-foreground [&_ul]:mb-4 [&_ul]:max-w-[65ch] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-4 [&_ol]:max-w-[65ch] [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1.5 [&_li]:text-muted-foreground">
      {children}
    </div>
  </section>
);

const GuidePage = () => {
  return (
    <div className="mx-auto flex max-w-[1200px] gap-10 px-4 md:px-8 lg:px-0">
      {/* Sidebar TOC - desktop only */}
      <nav className="sticky top-0 hidden h-fit w-56 shrink-0 self-start py-2 lg:block">
        <div className="mb-6 text-lg font-bold tracking-tight text-primary">
          EnTutor 指南
        </div>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5">
            <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {group.label}
            </div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground no-underline transition-colors hover:bg-primary/10 hover:text-primary"
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* Main content */}
      <div className="min-w-0 flex-1 pb-20">
        <div className="mb-12 border-b pb-8">
          <h1 className="mb-3 text-[32px] font-extrabold tracking-tight text-balance">
            EnTutor 使用指南
          </h1>
          <p className="max-w-[60ch] text-base leading-relaxed text-muted-foreground">
            EnTutor 是一个 AI 驱动的英语实战学习工具。通过对话、阅读、写作、听力、翻译五大练习模块，配合间隔重复记忆系统和智能学习引擎，帮助你在真实场景中提升英语能力。本指南将带你了解每个功能的详细使用方法。
          </p>
        </div>

        {/* 快速开始 */}
        <Section id="start" title="快速开始">
          <StepList>
            <Step index={1} title="打开应用">
              访问 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">https://en-tutorial.vercel.app</code>，或在本地运行{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">npm run dev</code> 后访问{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">http://localhost:3000</code>。
            </Step>
            <Step index={2} title="完成首次设置">
              首次打开会进入引导页面，选择你当前的英语水平（A2 / B1 / B2 /
              C1）。系统会根据你选择的等级自动标记一批基础词汇为&ldquo;已知&rdquo;，这样后续的词汇覆盖率计算才有意义。
            </Step>
            <Step index={3} title="配置 API Key">
              如果你在本地运行，需要在项目根目录的{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">.env.local</code>{" "}
              文件中填入你的 0G AI API Key。线上版本已预配置。
            </Step>
            <Step index={4} title="开始学习" isLast>
              进入仪表盘后，系统会自动生成今日学习计划。点击任意模块开始你的第一次练习。
            </Step>
          </StepList>

          <Tip label="建议">
            可以先去 Settings 页面点击&ldquo;Test API Connection&rdquo;，确认 AI
            服务连接正常后再开始练习。
          </Tip>
        </Section>

        {/* 首次设置 */}
        <Section id="onboarding" title="首次设置">
          <p>引导页面只会在第一次使用时出现。你需要选择一个最接近你当前水平的 CEFR 等级：</p>

          <RatingTable
            headers={["等级", "说明", "适合人群"]}
            rows={[
              [<Badge key="a2" color="green">A2</Badge>, "初级", "能理解简单句子，进行日常基础交流"],
              [<Badge key="b1" color="blue">B1</Badge>, "中级", "能处理大多数日常情境，能描述经历和计划"],
              [<Badge key="b2" color="purple">B2</Badge>, "中高级", "能与母语者流畅交流，能写详细的文章"],
              [<Badge key="c1" color="amber">C1</Badge>, "高级", "能灵活运用英语进行学术和职业沟通"],
            ]}
          />

          <p>选择后，系统会根据该等级自动将对应的常用词汇（数百个）标记为&ldquo;已知&rdquo;。这个设置影响：</p>
          <ul>
            <li>AI 对话时的语言复杂度调节</li>
            <li>阅读时的词汇覆盖率计算</li>
            <li>AI 生成文章的难度</li>
            <li>月度测评的基准参照</li>
          </ul>

          <Tip label="不确定选哪个?" variant="green">
            如果你犹豫不决，建议选低一级。比如你觉得自己&ldquo;差不多
            B2&rdquo;，那就选 B1。系统会通过月度测评自动调整你的等级。选低了不会影响学习效果，选高了反而会导致词汇覆盖率虚高。
          </Tip>
        </Section>

        {/* 仪表盘 */}
        <Section id="dashboard" title="仪表盘">
          <ModuleCard icon={<span>&#9776;</span>} title="Dashboard" path="/">
            这是你每天打开应用看到的第一个页面。它回答一个核心问题：
            <strong className="text-foreground">&ldquo;今天该做什么？&rdquo;</strong>
          </ModuleCard>

          <h3>智能学习引擎</h3>
          <p>
            打开 Dashboard，系统会根据当前时间显示问候语（早安 / 下午好 /
            晚上好），并自动生成一份个性化的学习计划。你只需要点击一个按钮
            —— <strong className="text-foreground">&ldquo;Start Full
            Session&rdquo;</strong> —— 就能开始今天的完整学习流程，无需自己规划做什么。
          </p>

          <p>计划生成算法：</p>
          <ul>
            <li>
              <strong className="text-foreground">复习优先级随学习目标切换</strong>{" "}
              — 精通轨道（mastery）下 SRS 复习永远优先；流利轨道（fluency，默认）下 SRS 与听力/阅读平等轮换，复习欠账不会挤占直接听懂练习
            </li>
            <li>
              <strong className="text-foreground">按闲置时间排序</strong> —
              其余环节按&ldquo;距离上次练习时间最久&rdquo;排序，优先安排你最久没做的活动类型
            </li>
            <li>
              <strong className="text-foreground">单次最多 3 种类型</strong>{" "}
              — 每次学习计划最多包含 3
              种不同的练习类型，避免一次塞太多任务
            </li>
          </ul>

          <p>
            每一个步骤旁边都会标注&ldquo;为什么推荐这一步&rdquo;（比如&ldquo;距离上次阅读已经
            3
            天&rdquo;），让你清楚计划背后的逻辑，而不是被动接受安排。每个步骤都可以单独开始，也可以跳过。整套计划的目标总时长约
            20 分钟。
          </p>
          <p>完成的项目会自动打勾。点击&ldquo;Start Full Session&rdquo;会跳转到计划中的第一个任务。</p>

          <h3>学习热力图</h3>
          <p>
            类似 GitHub 的贡献图，展示过去 180
            天每天的学习量。颜色越深代表当天活动越多。鼠标悬停可查看具体日期和活动数。
          </p>

          <h3>周报</h3>
          <p>自动对比本周与上周的数据变化：新学词汇数、修正的错误数、练习次数。上升显示绿色，下降显示红色。</p>

          <h3>词汇分布</h3>
          <p>一目了然地展示你所有 SRS 卡片的掌握状态分布：</p>
          <ul>
            <li>
              <Badge color="blue">New</Badge> — 刚加入，未复习
            </li>
            <li>
              <Badge color="amber">Learning</Badge> — 复习间隔 &lt; 7 天
            </li>
            <li>
              <Badge color="purple">Familiar</Badge> — 复习间隔 7-30 天
            </li>
            <li>
              <Badge color="green">Mastered</Badge> — 复习间隔 &gt; 30
              天且连续 3 次以上正确
            </li>
          </ul>
        </Section>

        {/* AI 对话 */}
        <Section id="conversation" title="AI 对话练习">
          <ModuleCard icon={<span>&#128172;</span>} title="Conversation" path="/conversation">
            与 AI
            进行真实场景的英语对话。AI
            会扮演特定角色（面试官、服务员、朋友等），保持场景一致性，并根据你的水平调整语言复杂度。
          </ModuleCard>

          <h3>四种入口方式</h3>
          <ol>
            <li>
              <strong className="text-foreground">Quick Start</strong> —
              一键随机匹配一个场景，最低门槛的入口
            </li>
            <li>
              <strong className="text-foreground">Free Chat</strong> —
              不设场景，随意聊天。适合&ldquo;就是想练练口语&rdquo;的时候
            </li>
            <li>
              <strong className="text-foreground">场景库</strong> — 从 20+
              预设场景中选择，按类别分组：
              <ul>
                <li>Daily Life：点餐、问路、购物、闲聊、交朋友</li>
                <li>Professional：面试、开会、演讲、谈判、技术讨论</li>
                <li>Travel：机场、酒店、看医生、租房、求助</li>
                <li>Social：辩论、讲故事、给建议、做计划、叙旧</li>
              </ul>
            </li>
            <li>
              <strong className="text-foreground">自定义场景</strong> —
              用中文或英文描述你想练习的情境，AI 自动设定场景
            </li>
          </ol>

          <h3>对话过程</h3>
          <FlowDiagram
            steps={["选择场景", "输入或语音", "AI 流式回复", "3 轮后可结束", "Session Review"]}
          />

          <ul>
            <li>
              <strong className="text-foreground">文字输入</strong>：在底部输入框直接打字发送
            </li>
            <li>
              <strong className="text-foreground">语音输入</strong>：点击麦克风按钮，用英语说话，系统自动转成文字（需要浏览器支持
              Speech Recognition）
            </li>
            <li>
              <strong className="text-foreground">AI 朗读</strong>：每条 AI
              消息旁有喇叭按钮，点击可以听 AI 的回复（使用 Edge 神经语音 TTS）
            </li>
            <li>
              <strong className="text-foreground">停止生成</strong>：AI
              正在回复时可以点击 Stop 按钮中断
            </li>
          </ul>

          <Tip label="重要" variant="amber">
            对话过程中 AI 不会纠正你的语法错误 —
            这是有意设计的。纠正放在 Session Review
            中进行，这样你在对话中可以专注于表达而不被打断。至少完成 3
            轮对话后才能结束并进入 Review。
          </Tip>

          <h3>Session Review</h3>
          <p>对话结束后，AI 会自动分析你的整个对话表现，生成一份详细的回顾报告：</p>

          <ul>
            <li>
              <strong className="text-foreground">评分卡片</strong> — 4
              个维度打分（1-10）：流畅度、准确性、词汇丰富度、句式复杂度
            </li>
            <li>
              <strong className="text-red-600 dark:text-red-400">
                错误纠正
              </strong>{" "}
              — 列出你说错的地方，显示原文 vs 正确表达 + 解释
            </li>
            <li>
              <strong className="text-amber-600 dark:text-amber-400">
                表达改进
              </strong>{" "}
              — 你说的没错但有更地道的说法，适合提升表达水平
            </li>
            <li>
              <strong className="text-emerald-600 dark:text-emerald-400">
                正面亮点
              </strong>{" "}
              — 你说得好的地方会被标绿表扬，强化正确习惯
            </li>
            <li>
              <strong className="text-primary">新词汇</strong> — AI
              在对话中使用的你可能不认识的词
            </li>
          </ul>

          <p>
            每个错误/改进/新词旁边都有{" "}
            <strong className="text-foreground">&ldquo;Add to SRS&rdquo;</strong>{" "}
            按钮。点击后该条目会自动变成一张复习卡片，进入间隔重复系统，确保你真正记住它。
          </p>
        </Section>

        {/* 沉浸式阅读 */}
        <Section id="reader" title="沉浸式阅读">
          <ModuleCard icon={<span>&#128214;</span>} title="Reader" path="/reader">
            用真实内容学英语。每个单词都可以点击查释义，遇到的生词自动进入复习系统。
          </ModuleCard>

          <h3>三种内容来源</h3>
          <ol>
            <li>
              <strong className="text-foreground">AI 生成文章</strong> —
              选择难度（A2-C1）和主题（科技、商业、科学、文化等），AI 会生成一篇
              300-500 词的文章。最方便，零摩擦。
            </li>
            <li>
              <strong className="text-foreground">粘贴文本</strong> —
              从任何地方复制英文文本直接粘贴进来。适合阅读你感兴趣的特定内容。
            </li>
            <li>
              <strong className="text-foreground">URL 导入</strong> —
              输入网页地址，系统自动提取文章正文。支持大多数新闻和博客站点。如果提取失败（付费墙、需要登录、JS
              渲染页面），系统会提示你改用粘贴方式。
            </li>
          </ol>

          <h3>阅读功能</h3>

          <p>
            <strong className="text-foreground">点击查词</strong>
            ：点击文章中任意单词，底部面板会显示该词在
            <em>当前上下文</em>
            中的释义（不是字典式定义），外加一个发音按钮和&ldquo;Add to
            SRS&rdquo;按钮。例如 &ldquo;run&rdquo; 在 &ldquo;run a
            company&rdquo; 中的释义会是&ldquo;经营、管理&rdquo;，而不是&ldquo;跑步&rdquo;。
          </p>

          <p>
            <strong className="text-foreground">难句解析</strong>
            ：遇到复杂长句？点击句子旁的分析按钮，AI 会拆解句子结构、解释语法点、并翻译成中文。
          </p>

          <p>
            <strong className="text-foreground">词汇覆盖率</strong>
            ：页面顶部显示&ldquo;You know X% of words in this
            article&rdquo;。这个数字基于你的基础词汇库 + SRS
            中已掌握的词。随着你学习更多词汇，这个覆盖率会逐渐上升 —
            这就是你进步的直观体现。
          </p>

          <p>
            <strong className="text-foreground">SRS 词汇高亮</strong>
            ：正在通过 SRS
            复习的词汇会在文章中以虚线下划线标记。在真实语境中再次遇到它们，有助于加深记忆。
          </p>

          <p>
            <strong className="text-foreground">完成阅读</strong>
            ：点击&ldquo;Finish
            Reading&rdquo;会显示本次阅读总结（查了多少词、花了多久、覆盖率变化），并更新你的学习统计。
          </p>
        </Section>

        {/* 写作练习 */}
        <Section id="writing" title="写作练习">
          <ModuleCard icon={<span>&#9998;</span>} title="Writing" path="/writing">
            写英文，获得 AI 逐句批改。不只标错，也标你写得好的地方。
          </ModuleCard>

          <h3>三种练习类型</h3>

          <p>
            <strong className="text-foreground">引导任务</strong>
            （适合系统练习）：
          </p>
          <ul>
            <li>商务邮件 — 提供结构模板（称呼 &rarr; 背景 &rarr; 请求 &rarr; 结尾），目标 100-150 词</li>
            <li>短文 — 论点 &rarr; 论据 &rarr; 总结结构，目标 200-300 词</li>
            <li>社交媒体帖子 — 吸引眼球 &rarr; 内容 &rarr; 行动号召，目标 50-100 词</li>
            <li>报告摘要 — 情况 &rarr; 发现 &rarr; 建议，目标 150-200 词</li>
          </ul>

          <p>
            <strong className="text-foreground">快速任务</strong>（适合热身）：
          </p>
          <ul>
            <li>中译英 — 给你一句中文，翻译成英文</li>
            <li>正式化改写 — 把一段口语化的句子改写成正式语气</li>
            <li>口语化改写 — 把一段正式的句子改写成日常表达</li>
            <li>场景描写 — 给你一个主题，用 3 句话描述</li>
          </ul>

          <p>
            <strong className="text-foreground">自由写作</strong>
            ：无主题限制，打开编辑器想写什么写什么。
          </p>

          <h3>AI 批改</h3>
          <p>写完后点击&ldquo;Submit for Review&rdquo;，AI 会对你的文章进行全面分析：</p>

          <ul>
            <li>
              <strong className="text-foreground">评分</strong>（1-10）—
              整体写作质量
            </li>
            <li>
              <strong className="text-foreground">逐句标注</strong> —
              文中的错误和建议用颜色高亮：
              <ul>
                <li>
                  <Badge color="red">红色</Badge> 语法错误 + 修正 + 解释
                </li>
                <li>
                  <Badge color="amber">黄色</Badge> 用词建议 + 替代表达
                </li>
                <li>
                  <Badge color="blue">蓝色</Badge> 风格改进 + 更地道的写法
                </li>
                <li>
                  <Badge color="green">绿色</Badge> 写得好的地方 — 正面强化
                </li>
              </ul>
            </li>
            <li>
              <strong className="text-foreground">润色版本</strong> — 完整的
              AI 改写版，方便你和原文逐句对比
            </li>
            <li>
              <strong className="text-foreground">错误模式</strong> —
              归纳你犯的错误类型（时态、冠词、介词等），帮助你识别自己的薄弱点
            </li>
          </ul>

          <p>每个错误标注都有&ldquo;Add to SRS&rdquo;按钮，让你的错误变成复习卡片，避免反复犯同样的错。</p>

          <Tip label="写作建议" variant="green">
            不要追求完美再提交。大胆写，写错了才有学习价值。AI
            批改的目的不是打分，而是帮你发现和修正表达习惯中的问题。
          </Tip>
        </Section>

        {/* 听力练习 */}
        <Section id="listening" title="听力练习">
          <ModuleCard icon={<span>&#127911;</span>} title="Listening" path="/listening">
            用耳朵学英语。AI 生成听力材料，Edge 神经语音（TTS）朗读，配合语音识别检测你的听写和跟读准确度。
          </ModuleCard>

          <h3>四种练习模式</h3>
          <ol>
            <li>
              <strong className="text-foreground">听写（Dictation）</strong>{" "}
              — AI 生成一句话，TTS 朗读出来，你把听到的内容打出来，系统逐词比对准确率。
            </li>
            <li>
              <strong className="text-foreground">听力理解（Listening Comprehension）</strong>{" "}
              — AI 生成一篇 100-150 词的听力短文，配 3
              道选择题，音频可以重复播放。
            </li>
            <li>
              <strong className="text-foreground">跟读（Shadowing，直接听懂三步法）</strong>{" "}
              — 先看语境在脑海中构造画面（不露英文），再反复听声音（可变速、多口音），最后揭示原文录音跟读，系统比对的是你说出的词与原文的词匹配度（内容准确度，非发音分）。听不懂的长句可一键拆成短语逐个理解。
            </li>
            <li>
              <strong className="text-foreground">预测（Prediction）</strong>{" "}
              — 听一段话的前半段，预测后半段会说什么，训练anticipation 能力。
            </li>
          </ol>

          <Tip label="建议" variant="green">
            建议佩戴耳机以获得最佳听音体验。语音识别功能在 Chrome 和 Edge
            浏览器中支持最好，其他浏览器可能无法使用或识别效果不佳。
          </Tip>
        </Section>

        {/* 翻译练习 */}
        <Section id="translate" title="翻译练习">
          <ModuleCard icon={<span>&#127760;</span>} title="Translate" path="/translate">
            中译英练习，AI 给出评分、逐句标注和润色版本，帮助你建立中英转换的语感。
          </ModuleCard>

          <h3>三种练习模式</h3>
          <ol>
            <li>
              <strong className="text-foreground">单句翻译</strong> —
              给出一句中文，翻译成英文，AI 评估你的译文。
            </li>
            <li>
              <strong className="text-foreground">段落翻译</strong> — 给出
              3-5 句组成的中文段落，练习结合上下文的整体翻译。
            </li>
            <li>
              <strong className="text-foreground">情境翻译</strong> —
              针对特定场景的文本（商务邮件、公共告示、日常对话等），练习符合场景语气和用词的翻译。
            </li>
          </ol>

          <h3>AI 评估</h3>
          <p>提交译文后，AI 会给出详细的评估反馈：</p>
          <ul>
            <li>
              <strong className="text-foreground">评分</strong>（1-10）—
              整体翻译质量
            </li>
            <li>
              <strong className="text-foreground">逐句标注</strong> —
              用颜色区分：
              <ul>
                <li>
                  <Badge color="red">错误</Badge> 误译或语法错误
                </li>
                <li>
                  <Badge color="amber">生硬</Badge> 意思对但表达不地道
                </li>
                <li>
                  <Badge color="green">优秀</Badge> 译得好的地方
                </li>
              </ul>
            </li>
            <li>
              <strong className="text-foreground">润色版本</strong> — 完整的
              AI 参考译文，方便逐句对比
            </li>
            <li>
              <strong className="text-foreground">关键差异</strong> —
              你的译文与参考译文之间的核心差异说明
            </li>
            <li>
              <strong className="text-foreground">备选译法</strong> —
              同一句话的其他合理译法
            </li>
            <li>
              <strong className="text-foreground">语法笔记</strong> —
              涉及的语法点讲解
            </li>
          </ul>

          <p>每个错误标注都有&ldquo;Add to SRS&rdquo;按钮，可以把翻译中暴露的问题加入复习卡片。</p>
        </Section>

        {/* SRS */}
        <Section id="srs" title="间隔重复复习 (SRS)">
          <ModuleCard icon={<span>&#129504;</span>} title="Review Cards" path="/srs">
            基于 SM-2
            算法的间隔重复系统。你在对话、阅读、写作中遇到的生词和错误表达会自动变成复习卡片，按科学间隔安排复习。SRS 属于&ldquo;精通轨道&rdquo;（mastery）：用于精确识记词汇与表达。如果你在&ldquo;流利轨道&rdquo;（fluency，默认）以直接听懂为目标，复习卡片不会挤占听力练习——遗忘是正常的，相同语料会在不同场景自然重现。
          </ModuleCard>

          <h3>卡片来源</h3>
          <p>卡片不需要手动创建（虽然也可以）。它们自动来自你的学习活动：</p>
          <ul>
            <li>
              <strong className="text-foreground">对话 Review</strong> —
              错误纠正、表达改进、新词汇
            </li>
            <li>
              <strong className="text-foreground">阅读查词</strong> —
              你点击查过的生词
            </li>
            <li>
              <strong className="text-foreground">写作批改</strong> — AI
              标出的错误表达
            </li>
            <li>
              <strong className="text-foreground">手动添加</strong> — 在
              Browse 页面自行添加任何你想记住的词
            </li>
          </ul>

          <h3>复习流程</h3>
          <FlowDiagram
            steps={["看卡片正面", "思考答案", "点击 Show Answer", "自我评估"]}
          />

          <p>看到答案后，根据你的掌握程度选择评分：</p>

          <RatingTable
            headers={["按钮", "含义", "下次复习"]}
            rows={[
              [<Badge key="again" color="red">Again</Badge>, "完全不记得", "1 分钟后"],
              [<Badge key="hard" color="amber">Hard</Badge>, "想起来了但费劲", "~10 分钟后"],
              [<Badge key="good" color="blue">Good</Badge>, "正常记得", "1-3 天后"],
              [<Badge key="easy" color="green">Easy</Badge>, "轻松记得", "4+ 天后"],
            ]}
          />

          <p>
            系统根据你每次的评分自动调整下次复习的时间间隔。经常按
            Good/Easy 的卡片间隔会越来越长（最终变成每月甚至更久复习一次），经常按
            Again 的卡片会保持短间隔反复出现。
          </p>

          <h3>卡片管理</h3>
          <p>
            在{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
              /srs/browse
            </code>{" "}
            页面可以：
          </p>
          <ul>
            <li>浏览所有卡片，按掌握程度筛选</li>
            <li>搜索特定单词或表达</li>
            <li>手动添加新卡片</li>
            <li>删除不需要的卡片</li>
            <li>查看各掌握阶段的卡片数量统计</li>
          </ul>

          <Tip label="核心原则">
            <strong className="text-foreground">精通轨道</strong>下，SRS
            的威力在于每天坚持复习——哪怕只有 5
            分钟，把到期的卡片过一遍，也比一次突击复习 1 小时有效得多。
            <strong className="text-foreground">流利轨道</strong>下则相反：遗忘是正常现象，不必为复习欠账焦虑。一路往前学新内容，相同语料会在不同练习场景里自然重现（交替重复），很快就能直接听懂。
          </Tip>
        </Section>

        {/* 学习档案 */}
        <Section id="profile" title="学习档案">
          <ModuleCard icon={<span>&#128200;</span>} title="Profile" path="/profile">
            所有学习数据的汇总视图。用图表直观展示你的进步轨迹。
          </ModuleCard>

          <h3>六大看板</h3>
          <ol>
            <li>
              <strong className="text-foreground">总览卡片</strong> — CEFR
              等级、已掌握词汇数、总对话次数、总阅读篇数、总写作字数
            </li>
            <li>
              <strong className="text-foreground">词汇增长图</strong> —
              过去 6 个月每月新增的 SRS 卡片数，用柱状图展示
            </li>
            <li>
              <strong className="text-foreground">对话评分趋势</strong> —
              最近 10 次对话的 4
              维评分（流畅度、准确性、词汇、句式复杂度）折线图，可以看到每个维度的进步或退步
            </li>
            <li>
              <strong className="text-foreground">错误模式分析</strong> —
              聚合所有写作批改中的错误类型，按频率排序。你能看到&ldquo;时态错误&rdquo;是不是在减少，&ldquo;介词搭配&rdquo;是不是新出现的薄弱点
            </li>
            <li>
              <strong className="text-foreground">练习分布</strong> —
              你的学习时间在对话、阅读、写作、SRS 之间的分配比例
            </li>
            <li>
              <strong className="text-foreground">里程碑成就</strong> —
              已获得和未获得的成就列表
            </li>
          </ol>

          <h3>里程碑</h3>
          <RatingTable
            headers={["成就", "达成条件"]}
            rows={[
              ["First Steps", "完成第一次对话"],
              ["Bookworm", "阅读 10 篇文章"],
              ["Wordsmith", "掌握 100 个词汇"],
              ["Persistent", "连续学习 7 天"],
              ["Dedicated", "连续学习 30 天"],
              ["Vocabulary Builder", "掌握 500 个词汇"],
            ]}
          />
        </Section>

        {/* 月度测评 */}
        <Section id="assessment" title="月度测评">
          <ModuleCard icon={<span>&#128203;</span>} title="Assessment" path="/assessment">
            每月一次的综合英语水平测评。测评结果会自动更新你的 CEFR 等级。
          </ModuleCard>

          <h3>测评结构</h3>
          <p>测评包含 4 个部分，按顺序进行，预计 15-20 分钟：</p>

          <StepList>
            <Step index={1} title="阅读理解">
              AI 生成一篇符合你水平的文章（约 200
              词），回答 5 道选择题。考察你对文章主旨、细节和推理的理解。
            </Step>
            <Step index={2} title="完形填空">
              一篇带有 8
              个空白的文章，你需要填入合适的词。系统会接受合理的同义词和变体形式。
            </Step>
            <Step index={3} title="写作任务">
              根据给定的提示写一段约 100 词的短文。AI
              从词汇、语法、逻辑三个角度评分。
            </Step>
            <Step index={4} title="对话测试" isLast>
              与 AI 进行 5 轮对话，话题由 AI
              随机选择。考察你的口语表达能力（通过文字形式）。
            </Step>
          </StepList>

          <h3>测评结果</h3>
          <ul>
            <li>
              <strong className="text-foreground">综合评分</strong> — 4
              个部分的平均分（0-100）
            </li>
            <li>
              <strong className="text-foreground">CEFR 等级判定</strong> —
              根据综合评分映射到 CEFR 区间（如&ldquo;B2 Upper&rdquo;）
            </li>
            <li>
              <strong className="text-foreground">与上次对比</strong> —
              如果不是第一次测评，会显示与上次的分数变化
            </li>
            <li>
              <strong className="text-foreground">各项分析</strong> —
              每个测评部分的单独分数和薄弱点分析
            </li>
            <li>
              <strong className="text-foreground">等级更新</strong> —
              如果测评结果与当前等级不同，系统会自动更新你的 CEFR
              等级，后续所有模块的难度会随之调整
            </li>
          </ul>

          <Tip label="建议频率">
            系统设计为每月一次测评。不建议过于频繁测评 —
            每月一次足以跟踪进步，过于频繁的测评可能让你焦虑于分数变化而忽视了日常练习。可以在任何时候手动发起测评。
          </Tip>
        </Section>

        {/* 高效使用建议 */}
        <Section id="tips" title="高效使用建议">
          <h3>每日推荐流程（约 20 分钟）</h3>
          <p className="text-sm text-muted-foreground">
            以下流程以精通轨道（mastery）为例。流利轨道（fluency，默认）下，Dashboard 会按&ldquo;最久没练&rdquo;轮换，SRS 复习不一定排首——这是正常的，遗忘在流利轨道下是可以接受的。
          </p>
          <FlowDiagram
            steps={["SRS 复习", "听力 / 对话（交替）", "翻译热身", "阅读 / 写作（交替）"]}
          />
          <StepList>
            <Step index={1} title="先复习 SRS 卡片（5 分钟）">
              把到期的卡片过一遍。这是保持记忆的关键环节，任何时候都不要跳过这一步。精通轨道用户尤其如此；流利轨道用户按 Dashboard 推荐即可，不必强求先复习。
            </Step>
            <Step index={2} title="做一次听力或对话（交替进行）">
              听力和对话交替安排。今天做听写或听力理解，明天做一次对话。完成后别忘了把
              Review 中的生词/错误加入 SRS。
            </Step>
            <Step index={3} title="翻译热身（几分钟）">
              做一两句单句翻译当作热身，帮助你在中英文之间快速切换语感，为后面的阅读/写作做准备。
            </Step>
            <Step index={4} title="做一次阅读或写作（交替进行）">
              阅读和写作交替进行。不需要每天都写长文，快速任务也很有价值。关键是保持每天都练一点。
            </Step>
            <Step index={5} title="看看 Dashboard（1 分钟）" isLast>
              确认今天的学习计划都完成了，看看连胜天数。这是你坚持的动力。
            </Step>
          </StepList>

          <h3>学习策略</h3>

          <Tip label="关于听力和翻译" variant="blue">
            听力和翻译是很多人容易忽略但收益很大的环节。听力练习（尤其是跟读）能直接改善你的听觉敏感度和发音；翻译练习则能强化你用英文准确表达中文思维的能力。建议把它们穿插进日常流程，而不是只练对话和阅读。
          </Tip>

          <Tip label="关于词汇" variant="green">
            不要刻意去背单词表。通过对话和阅读自然遇到的词汇，加入 SRS
            后通过间隔重复记住，比硬背效果好得多。每天接触 5-10 个新词就足够了。
          </Tip>

          <Tip label="关于错误">
            犯错是学习中最有价值的信号。写作批改中标出的错误，对话 Review
            中标出的错误 — 把它们全部加入
            SRS。当你发现某类错误（比如时态）在 Profile
            的错误分析中逐渐减少时，说明你正在进步。
          </Tip>

          <Tip label="关于坚持" variant="amber">
            连续性比强度重要。每天 15 分钟，连续 30
            天，比每周末集中 2
            小时效果好 10
            倍。系统的连胜机制（非惩罚性 —
            断了不归零）和热力图都是为了帮你保持这个习惯。
          </Tip>

          <h3>数据说明</h3>
          <p>
            你的所有学习数据（卡片、对话记录、阅读历史、写作记录、统计数据）都存储在浏览器本地的
            IndexedDB 中。这意味着：
          </p>
          <ul>
            <li>数据不会上传到服务器，完全私密</li>
            <li>换浏览器或清除浏览器数据会丢失学习记录</li>
            <li>建议定期在同一个浏览器中使用</li>
            <li>AI 对话内容会发送到 0G AI API 进行处理，但不会被存储</li>
          </ul>
        </Section>
      </div>
    </div>
  );
};

export default GuidePage;
