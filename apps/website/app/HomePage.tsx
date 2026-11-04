import WebInstallCommand from "./WebInstallCommand";

const WEBSITE_LOGO_SRC = "/logo-mark.svg?v=flywheel-brand-2";
const WEBSITE_LOGO_MARK_SRC = "/logo-mark.svg?v=flywheel-brand-1";

export type SiteLocale = "en" | "zh-CN";

const translations = {
  en: {
    footerSlogan: "Hulala. Growth in motion.",
    nav: ["The practice", "The workspace", "Principles"],
    cta: "Download Hulala",
    hero: {
      kicker: "An AI workspace for the long run",
      titleLead: "Hulala",
      titleAccent: "Growth in motion.",
      subtitle: "Read. Write. Code. Keep going.",
      lede: "Hulala is a quiet place for serious work—where daily reading becomes durable knowledge, writing sharpens thought, and code turns ideas into something useful.",
      primary: "Download for desktop",
      secondary: "Explore the practice",
      availability: "Unsigned desktop preview · macOS & Windows",
    },
    note: {
      header: "FIELD NOTES / 1184",
      date: "29 AUG 2026",
      label: "TODAY'S WORK",
      titleLead: "A body of work,",
      titleAccent: "still becoming.",
      copy: "The ideas worth keeping rarely arrive complete. They are read into being, written into clarity, and tested in the real world.",
      logs: [
        ["READ", "38 min", "12 notes kept"],
        ["WROTE", "684 words", "2 ideas clarified"],
        ["CODED", "3 files", "1 change shipped"],
      ],
      saved: "All work saved in context",
      day: "DAY 1,184 →",
    },
    conviction: {
      label: "A SIMPLE CONVICTION",
      title: ["Real growth", "is never built in a burst."],
      lines: ["It is built page by page.", "Paragraph by paragraph.", "Commit by commit."],
    },
    practice: {
      label: "01 / THE PRACTICE",
      title: ["One enduring practice.", "Three forms."],
      lede: "Reading, writing, and coding are not separate modes of productivity. They are how a curious person learns, thinks, and makes.",
      items: [
        ["Reading", "Enlarge the world available to you.", "Read across documents, notes, and code with an AI partner that helps you question carefully, connect ideas, and keep what matters.", "Documents · Codebases · Connected notes"],
        ["Writing", "Discover what you actually think.", "Move from fragments to a point of view. Draft and revise in the same place you researched, without sanding away your own voice.", "Notes · Drafts · In-context editing"],
        ["Coding", "Give an idea a working form.", "Understand a codebase, shape a plan, edit files, run commands, and examine the evidence with an agent inside your real workspace.", "Editor · Terminal · Git"],
      ],
    },
    continuity: {
      label: "02 / THE FLYWHEEL",
      title: ["A body of work.", "Not a history", "of prompts."],
      copy: "Hulala keeps the source material, conversation, edits, commands, and outcome attached to the workspace that produced them. Each turn of the flywheel begins with what you already know.",
      stages: [
        ["READ", "Take in", "Meet an idea worth understanding."],
        ["WRITE", "Think through", "Turn fragments into a point of view."],
        ["CODE", "Make real", "Give the thought a working form."],
        ["REPEAT", "Compound", "Let the outcome feed the next turn."],
      ],
    },
    workspace: {
      label: "03 / THE WORKSPACE",
      title: "Stay with the thought.",
      lede: "Files, editor, terminal, Git, and your AI agent share one context—locally or on your own remote machine.",
      treeTitle: "BODY OF WORK",
      folders: ["commonplace", "reading-notes.md", "questions.md", "essays", "projects"],
      documentLabel: "WORKING NOTE · 29 AUG 2026",
      documentTitle: "Continuity is a form of intelligence.",
      documentLede: "Good work deepens when each new effort can begin where the last one ended.",
      documentCopy: "The value of an AI workspace is not how many answers it produces. It is whether our questions become better—and whether what we learn remains available to the work ahead.",
      documentQuote: "Keep the thread. Let the idea take the time it needs.",
      saved: "Saved locally",
      partner: "AI PARTNER",
      agentMessage: "Your notes return to one idea: continuity is what turns information into judgment.",
      evidence: ["3 related notes", "2 earlier drafts", "1 working project"],
      userMessage: "Show me where the argument becomes too abstract. Don't rewrite it yet.",
      thinking: "Reading the full thread…",
      composer: "Continue the work…",
    },
    principles: {
      label: "04 / PRINCIPLES",
      title: ["Built against", "distraction."],
      lede: "Hulala is designed to support attention, continuity, and independent judgment—not another feed to keep up with.",
      items: [
        ["Depth over speed", "The answer is not the work. Understanding is."],
        ["Continuity over novelty", "Keep the thread instead of starting over."],
        ["Agency over automation", "AI should strengthen your judgment, not replace it."],
      ],
    },
    meaning: {
      label: "WHY HULALA?",
      title: ["Real growth is quiet", "for a long time.", "Then it moves."],
      copy: "Hulala is the sound of that movement—the flywheel turning after roots have been built patiently through reading, writing, and making.",
    },
    trust: {
      label: "THE FOUNDATION",
      title: "Your work stays yours.",
      copy: "Hulala is private and local-first. Your workspace, credentials, and agent tools remain under your control, without a Hulala account or hosted relay in the middle.",
      items: ["Runs on your machine", "Works over direct SSH", "Uses the agents you trust"],
    },
    closing: {
      label: "DESKTOP PREVIEW",
      title: ["Keep the flywheel", "turning."],
      copy: "Build the reading, writing, and coding practice that compounds with you.",
    },
  },
  zh: {
    footerSlogan: "呼啦啦，你的成长飞轮",
    nav: ["长期实践", "工作空间", "设计原则"],
    cta: "下载 Hulala",
    hero: {
      kicker: "为长期成长而生的 AI 工作空间",
      titleLead: "呼啦啦",
      titleAccent: "你的成长飞轮",
      subtitle: "阅读、写作、编程，持续前行",
      lede: "Hulala 是一个安静、专注的工作空间：让每天的阅读沉淀为知识，让写作磨砺思想，让代码把想法变成真实而有用的作品。",
      primary: "下载桌面版",
      secondary: "了解成长飞轮",
      availability: "未签名桌面预览版 · macOS 与 Windows",
    },
    note: {
      header: "长期笔记 / 1184",
      date: "2026 年 8 月 29 日",
      label: "今日积累",
      titleLead: "一生的作品，",
      titleAccent: "仍在生长。",
      copy: "值得留下的想法，很少一次成形。它们在阅读中萌芽，在写作中清晰，再到真实世界里经受检验。",
      logs: [
        ["阅读", "38 分钟", "留下 12 条笔记"],
        ["写作", "684 字", "想清楚 2 个问题"],
        ["编程", "3 个文件", "完成 1 次交付"],
      ],
      saved: "所有工作已沉淀为上下文",
      day: "第 1,184 天 →",
    },
    conviction: {
      label: "一个简单的信念",
      title: ["真正的成长，", "从来不靠一阵爆发。"],
      lines: ["它来自一页一页地读。", "一段一段地写。", "一次一次地提交。"],
    },
    practice: {
      label: "01 / 长期实践",
      title: ["同一种长期实践，", "三种表达方式。"],
      lede: "阅读、写作和编程不是三个割裂的效率模式，而是一个好奇的人学习、思考和创造的完整过程。",
      items: [
        ["阅读", "扩展你所能看见的世界。", "在文档、笔记和代码之间深入阅读。让 AI 帮你提出更好的问题、连接彼此的想法，并留下真正重要的内容。", "文档 · 代码库 · 关联笔记"],
        ["写作", "发现自己真正相信什么。", "从零散片段走向清晰观点。在研究发生的地方起草和修改，同时保留属于你自己的声音。", "笔记 · 草稿 · 上下文编辑"],
        ["编程", "让一个想法真正运转起来。", "理解代码库、制定计划、编辑文件、运行命令，并与 Agent 一起检验真实工作空间里的结果。", "编辑器 · 终端 · Git"],
      ],
    },
    continuity: {
      label: "02 / 成长飞轮",
      title: ["留下作品，", "而不是一段段", "消失的对话。"],
      copy: "Hulala 把材料、对话、修改、命令和成果留在产生它们的工作空间里。成长飞轮的每一次转动，都从你已经积累的地方继续。",
      stages: [
        ["阅读", "吸收", "遇见一个值得理解的想法。"],
        ["写作", "思考", "让零散片段形成自己的观点。"],
        ["编程", "创造", "让思想拥有可以运行的形态。"],
        ["再来一次", "复利", "让成果成为下一次转动的起点。"],
      ],
    },
    workspace: {
      label: "03 / 工作空间",
      title: "让思考保持连续。",
      lede: "文件、编辑器、终端、Git 和 AI Agent 共享同一份上下文——无论在本机，还是你自己的远程机器。",
      treeTitle: "我的长期作品",
      folders: ["日常积累", "阅读笔记.md", "问题清单.md", "文章", "项目"],
      documentLabel: "思考笔记 · 2026 年 8 月 29 日",
      documentTitle: "连续性，本身就是一种智能。",
      documentLede: "真正的好作品，总能从上一次停下的地方继续深入。",
      documentCopy: "AI 工作空间的价值，不在于它给出了多少答案，而在于我们的提问是否越来越好，以及今天学到的东西能否继续服务于明天的创造。",
      documentQuote: "保留那条线索，让想法拥有它所需要的时间。",
      saved: "已保存到本地",
      partner: "AI 伙伴",
      agentMessage: "你的这些笔记都指向同一个核心：连续性让信息逐渐沉淀为判断力。",
      evidence: ["3 条相关笔记", "2 篇早期草稿", "1 个进行中的项目"],
      userMessage: "告诉我论述从哪里开始变得抽象，但先不要替我重写。",
      thinking: "正在阅读完整脉络…",
      composer: "继续这项工作…",
    },
    principles: {
      label: "04 / 设计原则",
      title: ["为专注而设计，", "与分心相反。"],
      lede: "Hulala 支持专注、连续性和独立判断，而不是再制造一个需要你追赶的信息流。",
      items: [
        ["深度，而非速度", "答案不是工作本身，理解才是。"],
        ["连续，而非追新", "保留线索，不要每次从零开始。"],
        ["自主，而非代替", "AI 应该增强你的判断，而不是替代它。"],
      ],
    },
    meaning: {
      label: "为什么叫 HULALA？",
      title: ["真正的成长，", "会安静很久。", "然后呼啦啦地转起来。"],
      copy: "Hulala 是成长飞轮开始转动的声音。它不是捷径，而是阅读、写作和创造经过长期积累后，终于显现出来的力量。",
    },
    trust: {
      label: "基础原则",
      title: "你的工作，始终属于你。",
      copy: "Hulala 私有且本地优先。工作空间、凭据和 Agent 工具始终由你控制，中间没有 Hulala 账户体系或云端中继。",
      items: ["运行在你的机器上", "通过 SSH 直连远程机器", "使用你信任的 Agent"],
    },
    closing: {
      label: "桌面预览版",
      title: ["让成长飞轮，", "持续转动。"],
      copy: "建立一套能够与你共同复利的阅读、写作与编程实践。",
    },
  },
} as const;

export default function HomePage({ locale }: { locale: SiteLocale }) {
  const isZh = locale === "zh-CN";
  const t = isZh ? translations.zh : translations.en;
  const homeHref = isZh ? "/zh-CN/" : "/";
  const downloadHref = isZh ? "/zh-CN/download/" : "/download/";

  return (
    <main id="top" data-locale={isZh ? "zh" : "en"}>
      <header className="site-header">
        <a className="brand" href={homeHref} aria-label="Hulala home">
          <img src={WEBSITE_LOGO_SRC} alt="" />
          <span>Hulala</span>
        </a>
        <nav aria-label={isZh ? "主要导航" : "Primary navigation"}>
          <a href="#practice">{t.nav[0]}</a>
          <a href="#workspace">{t.nav[1]}</a>
          <a href="#principles">{t.nav[2]}</a>
        </nav>
        <div className="header-actions">
          <nav className="language-switcher static-glass" aria-label={isZh ? "语言" : "Language"}>
            <a className={!isZh ? "active" : ""} aria-current={!isZh ? "page" : undefined} href="/" hrefLang="en" lang="en">EN</a>
            <span />
            <a className={isZh ? "active" : ""} aria-current={isZh ? "page" : undefined} href="/zh-CN/" hrefLang="zh-CN" lang="zh-CN">中文</a>
          </nav>
          <a className="button static-glass button-small" href={downloadHref}>{t.cta} <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="kicker"><span /> {t.hero.kicker}</p>
          <h1>
            <span className="hero-title-lead">
              {t.hero.titleLead}
              <span className="hero-title-spinner" aria-hidden="true">
                <img src={WEBSITE_LOGO_MARK_SRC} alt="" />
              </span>
            </span>
            <br />
            <em>{t.hero.titleAccent}</em>
          </h1>
          <p className="hero-subtitle">{t.hero.subtitle}</p>
          <p className="hero-lede">{t.hero.lede}</p>
          <WebInstallCommand locale={locale} />
          <div className="hero-actions">
            <a className="button static-glass" href={downloadHref}>{t.hero.primary} <span aria-hidden="true">↗</span></a>
            <a className="plain-link" href="#practice">{t.hero.secondary} <span aria-hidden="true">↓</span></a>
          </div>
          <p className="availability">{t.hero.availability}</p>
        </div>

        <div className="field-note" aria-label={isZh ? "Hulala 每日积累记录" : "A daily practice record in Hulala"}>
          <div className="field-note-head">
            <span className="note-brand"><img src={WEBSITE_LOGO_MARK_SRC} alt="" /> HULALA</span>
            <span>{t.note.header}</span>
            <span>{t.note.date}</span>
          </div>
          <div className="field-note-body">
            <aside className="year-index" aria-hidden="true"><span>2021</span><i /><span>2022</span><i /><span>2023</span><i /><span>2024</span><i /><span>2025</span><i /><strong>2026</strong></aside>
            <div className="note-page">
              <p className="note-label">{t.note.label}</p>
              <h2>{t.note.titleLead}<br /><em>{t.note.titleAccent}</em></h2>
              <p>{t.note.copy}</p>
              <div className="practice-log">
                {t.note.logs.map(([label, value, detail]) => <div key={label}><span>{label}</span><strong>{value}</strong><i>{detail}</i></div>)}
              </div>
              <div className="note-footer"><span><i /> {t.note.saved}</span><span>{t.note.day}</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="conviction">
        <p className="section-label">{t.conviction.label}</p>
        <h2>{t.conviction.title[0]}<br />{t.conviction.title[1]}</h2>
        <p>{t.conviction.lines.map((line) => <em key={line}>{line}<br /></em>)}</p>
      </section>

      <section className="practice-section" id="practice">
        <div className="section-heading">
          <p className="section-label">{t.practice.label}</p>
          <h2>{t.practice.title[0]}<br />{t.practice.title[1]}</h2>
          <p>{t.practice.lede}</p>
        </div>
        <div className="practice-list">
          {t.practice.items.map(([name, line, copy, detail], index) => (
            <article className="practice-row" key={name}>
              <span className="practice-number">0{index + 1}</span><h3>{name}</h3>
              <div><strong>{line}</strong><p>{copy}</p></div><span className="practice-detail">{detail}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="continuity-section">
        <div className="continuity-copy">
          <p className="section-label">{t.continuity.label}</p>
          <h2>{t.continuity.title.map((line) => <span key={line}>{line}<br /></span>)}</h2>
          <p>{t.continuity.copy}</p>
        </div>
        <div className="continuity-path" aria-label={isZh ? "成长飞轮" : "The growth flywheel"}>
          <div className="path-line" />
          {t.continuity.stages.map(([step, title, copy]) => <article key={step}><span>{step}</span><strong>{title}</strong><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="workspace-section" id="workspace">
        <div className="workspace-heading"><p className="section-label">{t.workspace.label}</p><h2>{t.workspace.title}</h2><p>{t.workspace.lede}</p></div>
        <div className="workspace-window" aria-label={isZh ? "Hulala 桌面工作空间预览" : "Hulala desktop product preview"}>
          <div className="window-bar"><span className="window-dots"><i /><i /><i /></span><span className="window-title"><img src={WEBSITE_LOGO_MARK_SRC} alt="" /> long-work</span><span className="window-state"><i /> LOCAL</span></div>
          <div className="workspace-body">
            <aside className="activity-rail"><img src={WEBSITE_LOGO_MARK_SRC} alt="" /><span className="active">▤</span><span>⌕</span><span>⌘</span><span>⑂</span><i /></aside>
            <aside className="file-tree"><p>{t.workspace.treeTitle}</p><div className="folder open">⌄ &nbsp;{t.workspace.folders[0]}</div><span>{t.workspace.folders[1]}</span><span>{t.workspace.folders[2]}</span><div className="folder">› &nbsp;{t.workspace.folders[3]}</div><div className="folder">› &nbsp;{t.workspace.folders[4]}</div></aside>
            <div className="editor">
              <div className="editor-tabs"><span>{t.workspace.folders[1]}</span><span className="active">continuity.md</span><span>index.ts</span></div>
              <div className="document"><p className="document-label">{t.workspace.documentLabel}</p><h3>{t.workspace.documentTitle}</h3><p className="document-lede">{t.workspace.documentLede}</p><hr /><p>{t.workspace.documentCopy}</p><blockquote>{t.workspace.documentQuote}</blockquote></div>
              <div className="editor-footer"><span>Markdown</span><span>{t.workspace.saved}</span></div>
            </div>
            <aside className="agent-pane">
              <div className="agent-head"><span>{t.workspace.partner}</span><b>DeepSeek ▾</b></div>
              <div className="agent-thread"><div className="agent-message">{t.workspace.agentMessage}</div><div className="agent-evidence">{t.workspace.evidence.map((item) => <span key={item}>{item}</span>)}</div><div className="agent-message user">{t.workspace.userMessage}</div><div className="agent-thinking"><i /> {t.workspace.thinking}</div></div>
              <div className="composer"><span>{t.workspace.composer}</span><b>↑</b></div>
            </aside>
          </div>
        </div>
      </section>

      <section className="principles-section" id="principles">
        <div className="section-heading principles-heading"><p className="section-label">{t.principles.label}</p><h2>{t.principles.title[0]}<br />{t.principles.title[1]}</h2><p>{t.principles.lede}</p></div>
        <div className="principle-grid">{t.principles.items.map(([title, copy], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="meaning-section">
        <div className="meaning-mark" aria-hidden="true"><img src={WEBSITE_LOGO_MARK_SRC} alt="" /><span>HU·LA·LA</span></div>
        <div className="meaning-copy"><p className="section-label">{t.meaning.label}</p><h2>{t.meaning.title[0]}<br />{t.meaning.title[1]}<br /><em>{t.meaning.title[2]}</em></h2><p>{t.meaning.copy}</p></div>
      </section>

      <section className="trust-section">
        <div><p className="section-label">{t.trust.label}</p><h2>{t.trust.title}</h2></div><p>{t.trust.copy}</p>
        <ul>{t.trust.items.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ul>
      </section>

      <section className="closing-section">
        <img src={WEBSITE_LOGO_MARK_SRC} alt="" /><p className="section-label">{t.closing.label}</p><h2>{t.closing.title[0]}<br /><em>{t.closing.title[1]}</em></h2><p>{t.closing.copy}</p>
        <a className="button static-glass" href={downloadHref}>{t.cta} <span aria-hidden="true">↗</span></a>
      </section>

      <footer><a className="brand" href={homeHref} aria-label="Hulala home"><img src={WEBSITE_LOGO_SRC} alt="" /><span>Hulala</span></a><p>{t.footerSlogan}</p><div><span>Desktop · macOS & Windows</span><span>hello@hulala.ai</span></div></footer>
    </main>
  );
}
