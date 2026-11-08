import GitHubLink, { GITHUB_REPOSITORY } from "./GitHubLink";
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
      files: "Ctrl-D: Neovim on the Session directory — the bundled file tree, with a file open beside it.",
    },
    nav: ["The terminal", "The screens", "What we refuse"],
    cta: "Install Hulala",
    hero: {
      kicker: "The Hulala terminal client",
      titleLead: "Hulala",
      titleAccent: "DeepSeek Harness for hackers.",
      subtitle: "One TUI: Neovim, a real shell, a daemon you never babysit.",
      lede: "Hulala runs DeepSeek Harness in your terminal. One Host daemon owns the state root, every window attaches to it, and closing a window detaches instead of stopping the turn.",
      primary: "Install on macOS & Linux",
      secondary: "See what is inside",
      availability: "macOS & Linux · Node.js included · no tmux",
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
        ["Conversation", "The Agent Loop, streaming.", "Prompts, streaming output, approvals, questions and a model picker, straight from DeepSeek Harness's own surfaces.", "Shift-Cmd-S · /sessions · /model"],
        ["Shell", "Your shell, in the Session directory.", "A real pty with your rc files, aliases and PATH. Jobs keep running while the column is hidden.", "Ctrl-T · Ctrl-[ · Ctrl-]"],
        ["Editor", "Neovim, bundled.", "The real Neovim with its own colours, keymaps and buffers, shipped as a real binary so nothing has to be installed.", "Ctrl-D · Cmd-E · Ctrl-S"],
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
      github: "Open source · GPL-3.0 · Star on GitHub",
    },
    github: {
      label: "GitHub",
      headerAria: "Open the Hulala repository on GitHub",
      footer: "GitHub ↗",
    },
  },
  zh: {
    footerSlogan: "呼啦啦，面向 hacker 的 DeepSeek Harness",
    screens: {
      label: "客户端原样截图",
      conversation: "会话栏、对话、工具行和 composer。",
      terminal: "Ctrl-T：会话目录里你自己的 shell。",
      files: "Ctrl-D：在会话目录上打开 Neovim——内置文件树，旁边打开着一个文件。",
    },
    nav: ["终端", "截图", "我们不做什么"],
    cta: "安装 Hulala",
    hero: {
      kicker: "Hulala 终端客户端",
      titleLead: "Hulala",
      titleAccent: "面向 hacker 的 DeepSeek Harness",
      subtitle: "一个 TUI：内置 Neovim、真实 shell，还有一个你永远不用看着的守护进程。",
      lede: "Hulala 把 DeepSeek Harness 放进终端。一个 Host 守护进程拥有状态根目录，每个窗口都是连到它的客户端；关掉窗口只是断开，正在跑的 turn 不会停。",
      primary: "在 macOS 与 Linux 上安装",
      secondary: "看看里面有什么",
      availability: "macOS 与 Linux · 自带 Node.js · 不需要 tmux",
    },
    conviction: {
      label: "一个简单的信念",
      title: ["终端不应该", "跟着窗口一起死。"],
      lines: ["守护进程拥有状态根目录。", "每个窗口都是客户端。", "Ctrl-Q 只是断开，不是停。"],
    },
    practice: {
      label: "01 / 终端",
      title: ["一个窗口，", "三个面。"],
      lede: "左边会话栏，中间对话，右边一个侧栏——要么是你的 shell，要么是 Neovim。全在一个帧里，用你熟悉的键切换。",
      items: [
        ["对话", "Agent Loop 的原生面。", "prompt、流式输出、审批、提问和选模型，都是 DeepSeek Harness 自己的面，不是另抄一套。", "Shift-Cmd-S · /sessions · /model"],
        ["Shell", "会话目录里你自己的 shell。", "真实 pty，带着你的 rc、alias 和 PATH。列收起来，作业照样在跑。", "Ctrl-T · Ctrl-[ · Ctrl-]"],
        ["编辑器", "内置 Neovim。", "真正的 Neovim，自己的配色、键位和缓冲区；以真实二进制发布，机器上什么都不用装。", "Ctrl-F · 自动保存 · Ctrl-S"],
      ],
    },
    continuity: {
      label: "02 / 守护进程",
      title: ["Session 比启动它的", "那个窗口活得", "更久。"],
      copy: "Host 是守护进程，不是启动脚本。它拥有状态根目录，负责把 turn 跑完，并回应每一个连上来的客户端。",
      stages: [
        ["AB", "找到 Host", "客户端读 endpoint.json，没有就 detached 起一个。"],
        ["RUN", "送一个 turn", "Agent Loop 在 Host 里跑，每个窗口看到同一条流。"],
        ["DST", "关掉窗口", "Ctrl-Q 只是断开，turn 和它的工具继续跑。"],
        ["BACK", "再回来", "续上这个 Session，读你不在时跑完的部分。"],
      ],
    },
    principles: {
      label: "04 / 我们不做什么",
      title: ["我们反对", "伺候进程。"],
      lede: "不用记多路复用器的快捷键，不用守着启动脚本，不会有偷偷起的第二个守护进程，也没有第二套 REST。",
      items: [
        ["不需要 tmux", "Host 本身就是守护进程。连上、断开、再连上。"],
        ["一个状态根目录", "窗口共用一个 Host，Session 从来不是某个窗口的私产。"],
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
      copy: "Host 运行在你自己的机器上，只有一个状态根目录；provider 凭据留在它自己的原生存储里，中间没有 Hulala 账户，也没有云端中继。",
      items: ["运行在你的机器上", "不要账户，不要中继", "用你已经配好的模型"],
    },
    closing: {
      label: "终端客户端",
      title: ["开一个窗口，", "然后就让它跑着。"],
      copy: "macOS 与 Linux 一行命令安装，然后在任何地方运行 hulala。",
      github: "开源 · GPL-3.0 · 在 GitHub 上 Star",
    },
    github: {
      label: "GitHub",
      headerAria: "在 GitHub 上打开 Hulala 仓库",
      footer: "GitHub ↗",
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
          <a href="#screens">{t.nav[1]}</a>
          <a href="#principles">{t.nav[2]}</a>
        </nav>
        <div className="header-actions">
          <GitHubLink label={t.github.label} accessibleName={t.github.headerAria} />
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

        <figure className="hero-shot">
          <img src="/screens/03-files.png" alt={t.screens.files} width={1648} height={766} />
        </figure>
      </section>

      <section className="screens-section" id="screens" aria-label={isZh ? "Hulala 终端客户端截图" : "Hulala terminal client screenshots"}>
        <p className="section-label">{t.screens.label}</p>
        <div className="screens-pair">
          <figure>
            <img src="/screens/01-conversation.png" alt={t.screens.conversation} width={1161} height={640} />
            <figcaption>{t.screens.conversation}</figcaption>
          </figure>
          <figure>
            <img src="/screens/02-terminal.png" alt={t.screens.terminal} width={1161} height={640} />
            <figcaption>{t.screens.terminal}</figcaption>
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
        <div className="continuity-path" aria-label={isZh ? "Host 守护进程的生命周期" : "The Host daemon lifecycle"}>
          <div className="path-line" />
          {t.continuity.stages.map(([step, title, copy]) => <article key={step}><span>{step}</span><strong>{title}</strong><p>{copy}</p></article>)}
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
        <a className="closing-github" href={GITHUB_REPOSITORY} rel="noreferrer" target="_blank">{t.closing.github} <span aria-hidden="true">↗</span></a>
      </section>

      <footer><a className="brand" href={homeHref} aria-label="Hulala home"><img src={WEBSITE_LOGO_SRC} alt="" /><span>Hulala</span></a><p>{t.footerSlogan}</p><div><span>Terminal · macOS & Linux</span><a href={GITHUB_REPOSITORY} rel="noreferrer" target="_blank">{t.github.footer}</a><span>hello@hulala.ai</span></div></footer>
    </main>
  );
}
