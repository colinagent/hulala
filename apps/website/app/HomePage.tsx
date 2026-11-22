import GitHubLink, { GITHUB_REPOSITORY } from "./GitHubLink";
import LanguageSwitcher from "./LanguageSwitcher";
import WebInstallCommand from "./WebInstallCommand";
import { localePath, type SiteLocale } from "./i18n";

const WEBSITE_LOGO_SRC = "/logo-mark.svg?v=flywheel-brand-2";
const WEBSITE_LOGO_MARK_SRC = "/logo-mark.svg?v=flywheel-brand-1";

const translations = {
  en: {
    footerSlogan: "Hulala — the local agent that outlives your terminal window.",
    screens: {
      label: "THE CLIENT, UNRETOUCHED",
      hero: "The Hulala client: Session rail, conversation, tool rows and composer. Ctrl-Q detaches the window; the turn keeps running in the Host.",
      terminal: "Ctrl-T: your own shell in the Session directory, with its own scrollback.",
      files: "Ctrl-D: Neovim on the Session directory — the bundled file tree with a file open beside it.",
    },
    nav: ["The terminal", "The screens", "Another machine", "What we refuse"],
    cta: "Install Hulala",
    blog: "Blog",
    hero: {
      kicker: "HULALA · TERMINAL CLIENT ON DEEPSEEK HARNESS",
      titleLead: "Close the window.",
      titleAccent: "The work keeps going.",
      subtitle: "One TUI: your agent, Neovim and a real shell — one daemon behind them.",
      lede: "Hulala runs DeepSeek Harness on your machine. One Host owns the state root, so every window is just a client: detach with Ctrl-Q and the turn finishes without you.",
      points: [
        "The same agent answers in Telegram and Feishu.",
        "hulala ssh <host> opens a window on another machine.",
        "Plugins are DSH plugins, installed with hulala plugin.",
      ],
      primary: "All install options",
      secondary: "See what is inside",
      availability: "No account · no hosted relay · open source under GPL-3.0",
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
        ["Shell", "Your shell, in the Session directory.", "A real pty with your rc files, aliases and PATH. Jobs keep running while the column is hidden.", "Ctrl-T · Shift-Cmd-H · Shift-Cmd-L"],
        ["Editor", "Neovim, bundled.", "The real Neovim with its own colours, keymaps and buffers, shipped as a real binary so nothing has to be installed.", "Ctrl-D · Shift-Cmd-I · Ctrl-S"],
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
    remote: {
      label: "03 / ANOTHER MACHINE",
      title: ["The window is here.", "The work is there."],
      lede: "The client runs where you sit; the Host runs where the code is. Nothing is cloned, mounted or copied — the same window attaches to another machine's Host.",
      commandLabel: "One command",
      command: "hulala ssh devbox",
      hint: "devbox is an alias in your own ~/.ssh/config. /remote switches a window that is already open; /remote local comes back.",
      sides: [["This machine", "the window, the clipboard, the colours"], ["That machine", "the Host, the shell, Neovim, the Sessions"]],
      items: [
        ["Nothing installed by hand", "The client probes the machine first, and runs the same installer when Hulala is missing or behind. An unreachable machine, or a Host newer than this client, is reported instead of changed."],
        ["The shell and Neovim run over there", "A pty and a real Neovim on that state root, so the toolchain and the tree are the remote machine's. No copy on this side, no rsync, no mount."],
        ["This side keeps the clipboard", "Ctrl-V reads this clipboard and the file is written on the far side first, so the path that lands in the prompt is one the model can actually open."],
        ["It still looks like this machine", "The client hands the Host this terminal's colours, so the Neovim over there is painted with the theme of the window you are sitting at."],
      ],
    },
    principles: {
      label: "04 / WHAT WE REFUSE",
      title: ["Built to be", "left alone."],
      lede: "No multiplexer to remember, no runner script to keep alive, no second daemon hiding behind a window, no second REST layer.",
      items: [
        ["No tmux", "The Host is already a daemon. Attach, detach, reattach."],
        ["One state root", "Windows share one Host, so a Session is never a per-window thing."],
        ["One plugin system", "A plugin is a DSH bundle installed into the Host profile with hulala plugin. There is no second extension mechanism."],
      ],
    },
    meaning: {
      label: "WHY HULALA?",
      title: ["The window is closed.", "The keys keep", "clacking away."],
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
    footerSlogan: "呼啦啦——关掉窗口也还在跑的本地 Agent。",
    screens: {
      label: "客户端原样截图",
      hero: "Hulala 客户端：会话栏、对话、工具行和 composer。Ctrl-Q 只是断开窗口，turn 仍在 Host 里继续跑。",
      terminal: "Ctrl-T：会话目录里你自己的 shell，带独立回滚。",
      files: "Ctrl-D：在会话目录上打开 Neovim——内置文件树，旁边开着一个文件。",
    },
    nav: ["终端", "截图", "另一台机器", "我们不做什么"],
    cta: "安装 Hulala",
    blog: "博客",
    hero: {
      kicker: "HULALA · 基于 DEEPSEEK HARNESS 的终端客户端",
      titleLead: "关掉窗口，",
      titleAccent: "活儿还在跑。",
      subtitle: "一个 TUI：Agent、Neovim、真实 shell，背后一个守护进程。",
      lede: "Hulala 把 DeepSeek Harness 跑在你自己的机器上。一个 Host 拥有状态根目录，每个窗口都只是它的客户端；Ctrl-Q 断开，正在跑的 turn 照样收尾。",
      points: [
        "同一个 agent 也能在 Telegram 和飞书里回你。",
        "hulala ssh <host> 把窗口开到另一台机器上。",
        "插件就是 DSH 插件，用 hulala plugin 安装。",
      ],
      primary: "查看全部安装方式",
      secondary: "看看里面有什么",
      availability: "不要账户 · 不要云端中继 · GPL-3.0 开源",
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
        ["Shell", "会话目录里你自己的 shell。", "真实 pty，带着你的 rc、alias 和 PATH。列收起来，作业照样在跑。", "Ctrl-T · Shift-Cmd-H · Shift-Cmd-L"],
        ["编辑器", "内置 Neovim。", "真正的 Neovim，自己的配色、键位和缓冲区；以真实二进制发布，机器上什么都不用装。", "Ctrl-D · Ctrl-Shift-I · Ctrl-S"],
      ],
    },
    continuity: {
      label: "02 / 守护进程",
      title: ["Session 比启动它的", "那个窗口活得", "更久。"],
      copy: "Host 是守护进程，不是启动脚本。它拥有状态根目录，负责把 turn 跑完，并回应每一个连上来的客户端。",
      stages: [
        ["ATTACH", "找到 Host", "客户端读 endpoint.json，没有就 detached 起一个。"],
        ["RUN", "送一个 turn", "Agent Loop 在 Host 里跑，每个窗口看到同一条流。"],
        ["DETACH", "关掉窗口", "Ctrl-Q 只是断开，turn 和它的工具继续跑。"],
        ["REATTACH", "再回来", "续上这个 Session，读你不在时跑完的部分。"],
      ],
    },
    remote: {
      label: "03 / 另一台机器",
      title: ["窗口在这台，", "活儿在另一台。"],
      lede: "客户端跑在你坐的地方，Host 跑在代码所在的地方。不 clone、不挂载、不拷贝——只是同一个窗口接到了另一台机器的 Host 上。",
      commandLabel: "一条命令",
      command: "hulala ssh devbox",
      hint: "devbox 是你自己 ~/.ssh/config 里的 alias。在已开着的窗口里用 /remote 切换，/remote local 回来。",
      sides: [["这台机器", "窗口、剪贴板、配色"], ["那台机器", "Host、shell、Neovim、Session"]],
      items: [
        ["对面不用手动装", "客户端先探测；Hulala 没装或落后，就在那边跑同一个安装器。机器连不上，或者那边的 Host 比本机新，只报告，不改动。"],
        ["shell 和 Neovim 在那边跑", "那个状态根目录上的 pty 和真 Neovim，所以工具链和代码树都是远端的。本机不拷副本、不 rsync、不挂载。"],
        ["剪贴板留在这台", "Ctrl-V 读的是本机剪贴板，文件先写到对面，于是落进 prompt 的路径是模型真的能打开的那个。"],
        ["配色还是这一台的", "客户端把本终端的配色交给 Host，所以那边的 Neovim 用的是你眼前这个窗口的主题。"],
      ],
    },
    principles: {
      label: "04 / 我们不做什么",
      title: ["造出来，", "就是让你不用管。"],
      lede: "不用记多路复用器的快捷键，不用守着启动脚本，不会冒出第二个守护进程，也没有第二套 REST。",
      items: [
        ["不需要 tmux", "Host 本身就是守护进程。连上、断开、再连上。"],
        ["一个状态根目录", "窗口共用一个 Host，Session 从来不是某个窗口的私产。"],
        ["只有一套插件机制", "插件就是 DSH 插件，用 hulala plugin 装进 Host 的 profile；没有第二套扩展机制。"],
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
  const homeHref = localePath(locale, "/");
  const downloadHref = localePath(locale, "/download/");

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
          <a href="#remote">{t.nav[2]}</a>
          <a href="#principles">{t.nav[3]}</a>
          <a href={localePath(locale, "/blog/")}>{t.blog}</a>
        </nav>
        <div className="header-actions">
          <GitHubLink label={t.github.label} accessibleName={t.github.headerAria} />
          <LanguageSwitcher locale={locale} path="/" />
          <a className="button static-glass button-small" href={downloadHref}>{t.cta} <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <section className="hero">
        <div className="hero-head">
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
        </div>

        <div className="hero-grid">
          <div className="hero-detail">
            <p className="hero-lede">{t.hero.lede}</p>
            <ul className="hero-points">
              {t.hero.points.map((point, index) => (
                <li key={point}><span>0{index + 1}</span>{point}</li>
              ))}
            </ul>
            <WebInstallCommand locale={locale} />
            <div className="hero-actions">
              <a className="button static-glass" href={downloadHref}>{t.hero.primary} <span aria-hidden="true">↗</span></a>
              <a className="plain-link" href="#practice">{t.hero.secondary} <span aria-hidden="true">↓</span></a>
            </div>
            <p className="availability">{t.hero.availability}</p>
          </div>

          <figure className="hero-shot">
            <img src="/screens/01-conversation.png" alt={t.screens.hero} width={1161} height={640} />
            <figcaption>{t.screens.hero}</figcaption>
          </figure>
        </div>
      </section>

      <section className="screens-section" id="screens" aria-label={isZh ? "Hulala 终端客户端截图" : "Hulala terminal client screenshots"}>
        <p className="section-label">{t.screens.label}</p>
        <div className="screens-pair">
          <figure>
            <img src="/screens/02-terminal.png" alt={t.screens.terminal} width={1161} height={640} />
            <figcaption>{t.screens.terminal}</figcaption>
          </figure>
          <figure>
            <img src="/screens/03-files.png" alt={t.screens.files} width={1648} height={766} />
            <figcaption>{t.screens.files}</figcaption>
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

      <section className="remote-section" id="remote">
        <div className="section-heading">
          <p className="section-label">{t.remote.label}</p>
          <h2>{t.remote.title[0]}<br /><em>{t.remote.title[1]}</em></h2>
          <p>{t.remote.lede}</p>
        </div>
        <div className="remote-body">
          <div className="remote-here">
            <div className="remote-command">
              <p className="remote-command-bar"><i /><i /><i /><span>{t.remote.commandLabel}</span></p>
              <code>{t.remote.command}</code>
              <small>{t.remote.hint}</small>
            </div>
            <div className="remote-sides">
              {t.remote.sides.map(([name, what]) => (
                <div key={name}><span>{name}</span><p>{what}</p></div>
              ))}
            </div>
          </div>
          <ul className="remote-points">
            {t.remote.items.map(([title, copy], index) => (
              <li key={title}><span>0{index + 1}</span><strong>{title}</strong><p>{copy}</p></li>
            ))}
          </ul>
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

      <footer><a className="brand" href={homeHref} aria-label="Hulala home"><img src={WEBSITE_LOGO_SRC} alt="" /><span>Hulala</span></a><p>{t.footerSlogan}</p><div><span>Terminal · macOS & Linux</span><a href={localePath(locale, "/blog/")}>{t.blog}</a><a href={GITHUB_REPOSITORY} rel="noreferrer" target="_blank">{t.github.footer}</a><span>hello@hulala.ai</span></div></footer>
    </main>
  );
}
