import WebInstallCommand from "./WebInstallCommand";

const WEBSITE_LOGO_SRC = "/logo-mark.svg?v=flywheel-brand-2";
const WEBSITE_LOGO_MARK_SRC = "/logo-mark.svg?v=flywheel-brand-1";

export type SiteLocale = "en" | "zh-CN";

const translations = {
  en: {
    footerSlogan: "Hulala. DeepSeek Harness for hackers.",
    screens: {
      label: "THE CLIENT, UNRETOUCHED",
      conversation: "Session rail, conversation, tool rows and the composer.",
      terminal: "Ctrl-T: your shell in the Session directory.",
      editor: "Ctrl-F: Neovim beside the conversation.",
    },
    nav: ["The terminal", "The workspace", "What we refuse"],
    cta: "Install Hulala",
    hero: {
      kicker: "The Hulala terminal client",
      titleLead: "Hulala",
      titleAccent: "DeepSeek Harness for hackers.",
      subtitle: "One TUI: Neovim, a real shell, a daemon you never babysit.",
      lede: "Hulala runs DeepSeek Harness in your terminal. One Host daemon owns the state root, every window attaches to it, and closing a window detaches instead of stopping the turn.",
      primary: "Install on macOS & Linux",
      secondary: "See what is inside",
      availability: "macOS & Linux · Node.js 22.13+ · no tmux",
    },
    note: {
      header: "WINDOWS ATTACHED / 4",
      date: "RIGHT NOW",
      label: "ONE DAEMON",
      titleLead: "The window is gone.",
      titleAccent: "The turn is not.",
      copy: "A turn belongs to the Host, not to the window that asked for it. Close the terminal, open another, and the transcript is still being written.",
      logs: [
        ["WINDOWS", "4 attached", "1 daemon"],
        ["TURNS", "1 running", "2 queued"],
        ["PLUGINS", "17 loaded", "2 yours"],
      ],
      saved: "One state root, one Host",
      day: "STATE ROOT →",
    },
    conviction: {
      label: "A SIMPLE CONVICTION",
      title: ["A terminal should not", "die with its window."],
      lines: ["One daemon owns the state root.", "Every window is a client.", "Ctrl-Q detaches; it does not stop."],
    },
    practice: {
      label: "01 / THE TERMINAL",
      title: ["One window.", "Three surfaces."],
      lede: "The Session rail, the conversation, and one sidebar that is either your shell or Neovim — in one frame, driven by keys you already know.",
      items: [
        ["Conversation", "The Agent Loop, streaming.", "Prompts, streaming output, approvals, questions and a model picker, straight from DeepSeek Harness's own surfaces.", "Ctrl-G · /sessions · /model"],
        ["Shell", "Your shell, in the Session directory.", "A real pty with your rc files, aliases and PATH. Jobs keep running while the column is hidden.", "Ctrl-T · Ctrl-[ · Ctrl-]"],
        ["Editor", "Neovim, bundled.", "The real Neovim with its own colours, keymaps and buffers, shipped as a real binary so nothing has to be installed.", "Ctrl-F · autosave · Ctrl-S"],
      ],
    },
    continuity: {
      label: "02 / THE DAEMON",
      title: ["A Session that outlives", "the window that", "started it."],
      copy: "The Host is a daemon, not a runner script. It owns the state root, keeps the turn going, and answers every client that attaches to it.",
      stages: [
        ["ATTACH", "Find the Host", "A client reads endpoint.json, or starts one detached."],
        ["RUN", "Send a turn", "The Agent Loop runs in the Host; every window sees the stream."],
        ["DETACH", "Close the window", "Ctrl-Q detaches. The turn and its tools keep going."],
        ["REATTACH", "Come back", "Resume the Session and read what finished without you."],
      ],
    },
    workspace: {
      label: "03 / THE WORKSPACE",
      title: "Stay in one frame.",
      lede: "Files, the editor, the shell and the agent share one context, in one terminal window.",
      treeTitle: "HULALA",
      folders: ["apps", "scripts", "docs", "screens", "plugins"],
      documentLabel: "INPUTSOURCE.TS",
      documentTitle: "Every panel that reads keys asks for English.",
      documentLede: "The composer never switches: it keeps the source you left there.",
      documentCopy: "Ctrl-[ is byte-identical to Esc, so the client has to know whether the editor still has something to cancel before it takes the key for itself.",
      documentQuote: "Preserve the source; hand it back when the panel leaves.",
      saved: "Saved automatically",
      partner: "AGENT",
      agentMessage: "The column kept its process, so your buffer is exactly where you left it.",
      evidence: ["3 changed files", "12 passing tests", "1 running turn"],
      userMessage: "Open the editor on the file that switches the input source.",
      thinking: "Reading apps/cli/src/tui/editor…",
      composer: "Ask for the next change…",
    },
    principles: {
      label: "04 / WHAT WE REFUSE",
      title: ["Built against", "the babysitting."],
      lede: "No multiplexer to remember, no runner script to keep alive, no private rival daemon, no second REST layer.",
      items: [
        ["No tmux", "The Host is already a daemon. Attach, detach, reattach."],
        ["One state root", "Windows share one Host, so a Session is never a per-window thing."],
        ["Yours to rewrite", "Every panel is a plugin, and the contract only ever grows."],
      ],
    },
    meaning: {
      label: "WHY HULALA?",
      title: ["The window is closed.", "The keyboard keeps", "clicking along."],
      copy: "呼啦啦 is the sound of a terminal still working after you walked away: a turn finishing, a shell job landing, a Session waiting for you to reattach.",
    },
    trust: {
      label: "THE FOUNDATION",
      title: "Your work stays yours.",
      copy: "The Host runs on your machine under one state root, provider credentials stay in the owning Provider's store, and there is no Hulala account or hosted relay in the middle.",
      items: ["Runs on your machine", "No account, no relay", "Uses the models you configured"],
    },
    closing: {
      label: "TERMINAL CLIENT",
      title: ["Open a window.", "Leave it running."],
      copy: "Install the client on macOS or Linux with one command, then run hulala wherever you work.",
    },
  },
  zh: {
    footerSlogan: "呼啦啦，面向黑客的 DeepSeek Harness",
    screens: {
      label: "客户端原样截图",
      conversation: "会话栏、对话、工具行和 composer。",
      terminal: "Ctrl-T：会话目录里你自己的 shell。",
      editor: "Ctrl-F：对话旁边的 Neovim。",
    },
    nav: ["终端", "工作空间", "我们不做什么"],
    cta: "安装 Hulala",
    hero: {
      kicker: "Hulala 终端客户端",
      titleLead: "Hulala",
      titleAccent: "面向黑客的 DeepSeek Harness",
      subtitle: "一个 TUI：内置 Neovim、真实 shell，还有一个你永远不用看着的 daemon。",
      lede: "Hulala 把 DeepSeek Harness 放进终端。一个 Host daemon 拥有 state root，每个窗口都是连到它的客户端；关掉窗口只是断开，正在跑的 turn 不会停。",
      primary: "在 macOS 与 Linux 上安装",
      secondary: "看看里面有什么",
      availability: "macOS 与 Linux · Node.js 22.13+ · 不需要 tmux",
    },
    note: {
      header: "已连窗口 / 4",
      date: "就在此刻",
      label: "一个 daemon",
      titleLead: "窗口已经关了，",
      titleAccent: "turn 还在跑。",
      copy: "turn 属于 Host，不属于发起它的窗口。关掉终端、再开一个，transcript 还在继续写。",
      logs: [
        ["窗口", "连了 4 个", "1 个 daemon"],
        ["turn", "1 个在跑", "2 个排队"],
        ["插件", "载入 17 个", "2 个是你的"],
      ],
      saved: "一个 state root，一个 Host",
      day: "STATE ROOT →",
    },
    conviction: {
      label: "一个简单的信念",
      title: ["终端不应该", "跟着窗口一起死。"],
      lines: ["daemon 拥有 state root。", "每个窗口都是客户端。", "Ctrl-Q 只是断开，不是停。"],
    },
    practice: {
      label: "01 / 终端",
      title: ["一个窗口，", "三个面。"],
      lede: "左边会话栏，中间对话，右边一个侧栏——要么是你的 shell，要么是 Neovim。全在一个帧里，用你熟悉的键切换。",
      items: [
        ["对话", "Agent Loop 的原生面。", "prompt、流式输出、审批、提问和选模型，都是 DeepSeek Harness 自己的面，不是另抄一套。", "Ctrl-G · /sessions · /model"],
        ["Shell", "会话目录里你自己的 shell。", "真实 pty，带着你的 rc、alias 和 PATH。列收起来，作业照样在跑。", "Ctrl-T · Ctrl-[ · Ctrl-]"],
        ["编辑器", "内置 Neovim。", "真正的 Neovim，自己的配色、键位和缓冲区；以真实二进制发布，机器上什么都不用装。", "Ctrl-F · 自动保存 · Ctrl-S"],
      ],
    },
    continuity: {
      label: "02 / daemon",
      title: ["Session 比启动它的", "那个窗口活得", "更久。"],
      copy: "Host 是 daemon，不是启动脚本。它拥有 state root，负责把 turn 跑完，并回应每一个连上来的客户端。",
      stages: [
        ["AB", "找到 Host", "客户端读 endpoint.json，没有就 detached 起一个。"],
        ["RUN", "送一个 turn", "Agent Loop 在 Host 里跑，每个窗口看到同一条流。"],
        ["DST", "关掉窗口", "Ctrl-Q 只是断开，turn 和它的工具继续跑。"],
        ["BACK", "再回来", "续上这个 Session，读你不在时跑完的部分。"],
      ],
    },
    workspace: {
      label: "03 / 工作空间",
      title: "留在一个帧里。",
      lede: "文件、编辑器、shell 和 agent 共用一份上下文，就在一个终端窗口里。",
      treeTitle: "HULALA",
      folders: ["apps", "scripts", "docs", "screens", "plugins"],
      documentLabel: "INPUTSOURCE.TS",
      documentTitle: "每个读按键的面板都要求英文。",
      documentLede: "composer 永远不切：你留在那里的输入法就是它用的。",
      documentCopy: "Ctrl-[ 和 Esc 是同一个字节，所以客户端必须先知道编辑器还有没有东西可取消，才决定要不要把这颗键拿走。",
      documentQuote: "保住输入源，面板离开时再还回去。",
      saved: "已自动保存",
      partner: "AGENT",
      agentMessage: "列保留了自己的进程，所以缓冲区还在你离开时的位置。",
      evidence: ["3 个改动文件", "12 个通过的测试", "1 个正在跑的 turn"],
      userMessage: "在编辑器里打开那个切换输入源的文件。",
      thinking: "正在读 apps/cli/src/tui/editor…",
      composer: "接着改下一个…",
    },
    principles: {
      label: "04 / 我们不做什么",
      title: ["我们反对", "伺候进程。"],
      lede: "不用记多路复用器的快捷键，不用守着启动脚本，不会有偷偷起的第二个 daemon，也没有第二套 REST。",
      items: [
        ["不需要 tmux", "Host 本身就是 daemon。连上、断开、再连上。"],
        ["一个 state root", "窗口共用一个 Host，Session 从来不是某个窗口的私产。"],
        ["随便你改", "每个面板都是插件，契约只增不改。"],
      ],
    },
    meaning: {
      label: "为什么叫 HULALA？",
      title: ["窗口已经关了，", "键盘还在那里", "呼啦啦地响。"],
      copy: "呼啦啦是你走开之后终端还在工作的声音：一个 turn 跑完，一个 shell 作业落地，一个 Session 等着你重新连上。",
    },
    trust: {
      label: "基础原则",
      title: "你的工作，始终属于你。",
      copy: "Host 运行在你自己的机器上，只有一个 state root；provider 凭据留在它自己的原生存储里，中间没有 Hulala 账户，也没有云端中继。",
      items: ["运行在你的机器上", "不要账户，不要中继", "用你已经配好的模型"],
    },
    closing: {
      label: "终端客户端",
      title: ["开一个窗口，", "然后就让它跑着。"],
      copy: "macOS 与 Linux 一行命令安装，然后在任何地方运行 hulala。",
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

      <section className="screens-section" aria-label={isZh ? "Hulala 终端客户端截图" : "Hulala terminal client screenshots"}>
        <p className="section-label">{t.screens.label}</p>
        <figure className="screens-main">
          <img src="/screens/01-conversation.png" alt={t.screens.conversation} width={1161} height={640} />
          <figcaption>{t.screens.conversation}</figcaption>
        </figure>
        <div className="screens-pair">
          <figure>
            <img src="/screens/02-terminal.png" alt={t.screens.terminal} width={1161} height={640} />
            <figcaption>{t.screens.terminal}</figcaption>
          </figure>
          <figure>
            <img src="/screens/03-editor.png" alt={t.screens.editor} width={1161} height={640} />
            <figcaption>{t.screens.editor}</figcaption>
          </figure>
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
        <div className="continuity-path" aria-label={isZh ? "Host daemon 的生命周期" : "The Host daemon lifecycle"}>
          <div className="path-line" />
          {t.continuity.stages.map(([step, title, copy]) => <article key={step}><span>{step}</span><strong>{title}</strong><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="workspace-section" id="workspace">
        <div className="workspace-heading"><p className="section-label">{t.workspace.label}</p><h2>{t.workspace.title}</h2><p>{t.workspace.lede}</p></div>
        <div className="workspace-window" aria-label={isZh ? "Hulala 桌面工作空间预览" : "Hulala desktop product preview"}>
          <div className="window-bar"><span className="window-dots"><i /><i /><i /></span><span className="window-title"><img src={WEBSITE_LOGO_MARK_SRC} alt="" /> hulala</span><span className="window-state"><i /> ATTACHED</span></div>
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

      <footer><a className="brand" href={homeHref} aria-label="Hulala home"><img src={WEBSITE_LOGO_SRC} alt="" /><span>Hulala</span></a><p>{t.footerSlogan}</p><div><span>Terminal · macOS & Linux</span><span>hello@hulala.ai</span></div></footer>
    </main>
  );
}
