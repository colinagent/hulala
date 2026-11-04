import type { DesktopReleaseAsset, DesktopReleaseManifest } from "@hulala/desktop-contracts/release-manifest";
import type { SiteLocale } from "../HomePage";
import WebInstallCommand from "../WebInstallCommand";

const APPLE_GUIDE = "https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/26/mac/26";
const SMARTSCREEN_GUIDE = "https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation";
const SMART_APP_CONTROL_GUIDE = "https://support.microsoft.com/en-US/Windows/Security/threat-malware-protection/smart-app-control-frequently-asked-questions";
const GITHUB_RELEASES = "https://github.com/colinagent/hulala/releases";

const copy = {
  en: {
    eyebrow: "DESKTOP / DOWNLOAD",
    title: "Take the work with you.",
    intro: "Hulala runs locally on your computer. This preview has no Apple Developer ID or Windows Authenticode signature, so verify the checksum and follow the first-launch instructions below.",
    version: "Version",
    published: "Published",
    macTitle: "Hulala for macOS",
    macArch: "Apple silicon · macOS 13 or later",
    winTitle: "Hulala for Windows",
    winArch: "Windows 11 · 64-bit · Git for Windows required for Git features",
    macCta: "Download DMG",
    winCta: "Download EXE",
    macDownloadNotice: "IMPORTANT: This build is unsigned. If macOS blocks the first launch, follow the macOS steps below.",
    winDownloadNotice: "IMPORTANT: This build is unsigned. If Windows shows a protection warning, follow the Windows steps below.",
    checksum: "SHA-256",
    macWarning: "macOS will block the first launch",
    macBody: "This build has no Apple Developer ID signature or notarization. Only continue after confirming the download source and SHA-256 above.",
    macSteps: ["Open the DMG and drag Hulala to Applications.", "Try to open Hulala once, then dismiss the warning.", "Open System Settings → Privacy & Security, scroll to Security, choose Open Anyway, authenticate, then choose Open."],
    macNote: "Apple says Open Anyway is available for about one hour after the blocked launch attempt.",
    winWarning: "Windows will show Unknown publisher",
    winBody: "This installer has no Authenticode signature. Only continue after confirming the download source and SHA-256 above.",
    winSteps: ["Open the downloaded installer.", "On Windows protected your PC, choose More info.", "Confirm the app name, then choose Run anyway and finish setup."],
    winNote: "If Smart App Control or an organization policy offers no Run anyway action, there is no safe per-app bypass. Keep protection enabled and wait for a signed build or contact your administrator.",
    official: "Official guidance",
    github: "View GitHub Release",
    fallbackTitle: "The release feed is temporarily unavailable.",
    fallbackBody: "Use the public GitHub Releases page and verify the published SHA-256 before installing.",
    home: "Back to Hulala",
  },
  zh: {
    eyebrow: "桌面版 / 下载",
    title: "让工作随你继续。",
    intro: "Hulala 在你的电脑本地运行。当前预览版没有 Apple Developer ID 或 Windows Authenticode 签名，请先核对下载来源和校验值，再按下方说明完成首次启动。",
    version: "版本",
    published: "发布时间",
    macTitle: "Hulala macOS 版",
    macArch: "Apple 芯片 · macOS 13 或更高版本",
    winTitle: "Hulala Windows 版",
    winArch: "Windows 11 · 64 位 · Git 功能需安装 Git for Windows",
    macCta: "下载 DMG",
    winCta: "下载 EXE",
    macDownloadNotice: "重点提示：当前版本未签名。下载后首次打开如被拦截，请按下方 macOS 步骤操作。",
    winDownloadNotice: "重点提示：当前版本未签名。如 Windows 显示保护警告，请按下方 Windows 步骤操作。",
    checksum: "SHA-256",
    macWarning: "macOS 会阻止首次启动",
    macBody: "此版本没有 Apple Developer ID 签名，也没有经过 Apple 公证。只有在确认下载来源和上方 SHA-256 后才应继续。",
    macSteps: ["打开 DMG，把 Hulala 拖入“应用程序”。", "先尝试打开一次 Hulala，然后关闭系统警告。", "打开“系统设置”→“隐私与安全性”，滚动到“安全性”，点“仍要打开”，完成身份验证后再次点“打开”。"],
    macNote: "Apple 说明：“仍要打开”按钮通常只在被阻止后的约一小时内出现。",
    winWarning: "Windows 会显示“未知发布者”",
    winBody: "此安装器没有 Authenticode 签名。只有在确认下载来源和上方 SHA-256 后才应继续。",
    winSteps: ["打开下载完成的安装器。", "看到“Windows 已保护你的电脑”时，选择“更多信息”。", "核对应用名称，然后选择“仍要运行”并完成安装。"],
    winNote: "如果 Smart App Control 或单位策略没有提供“仍要运行”，系统目前没有安全的单应用绕过方式。请保留安全保护，等待签名版本或联系管理员。",
    official: "官方说明",
    github: "查看 GitHub Release",
    fallbackTitle: "发布下载源暂时不可用。",
    fallbackBody: "请前往公开 GitHub Releases 页面，并在安装前核对发布的 SHA-256。",
    home: "返回 Hulala",
  },
} as const;

function bytes(size: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function DownloadCard({ asset, title, subtitle, cta, checksum, notice }: { asset: DesktopReleaseAsset; title: string; subtitle: string; cta: string; checksum: string; notice: string }) {
  return (
    <article className="download-card">
      <div><p className="download-platform">{subtitle} · {bytes(asset.size)}</p><h2>{title}</h2></div>
      <div className="download-action"><a className="button static-glass" href={asset.url}>{cta}<span aria-hidden="true">↓</span></a><p className="download-important">{notice}</p></div>
      <div className="download-checksum"><strong>{checksum}</strong><code>{asset.sha256}</code></div>
    </article>
  );
}

function Notice({ title, body, steps, note, links }: { title: string; body: string; steps: readonly string[]; note: string; links: Array<{ label: string; href: string }> }) {
  return (
    <aside className="install-notice">
      <p className="section-label">UNSIGNED PREVIEW</p><h3>{title}</h3><p>{body}</p>
      <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol><p className="notice-note">{note}</p>
      <div className="notice-links">{links.map((link) => <a href={link.href} key={link.href} rel="noreferrer" target="_blank">{link.label} ↗</a>)}</div>
    </aside>
  );
}

export default function DownloadPageClient({ release, locale }: { release: DesktopReleaseManifest | null; locale: SiteLocale }) {
  const isZh = locale === "zh-CN";
  const t = isZh ? copy.zh : copy.en;
  const homeHref = isZh ? "/zh-CN/" : "/";
  return (
    <main className="download-page" data-locale={isZh ? "zh" : "en"}>
      <header className="site-header download-header">
        <a className="brand" href={homeHref}><img src="/logo-mark.svg" alt=""/><span>Hulala</span></a>
        <div className="header-actions"><nav className="language-switcher static-glass" aria-label={isZh ? "语言" : "Language"}><a className={!isZh ? "active" : ""} aria-current={!isZh ? "page" : undefined} href="/download/" hrefLang="en" lang="en">EN</a><span/><a className={isZh ? "active" : ""} aria-current={isZh ? "page" : undefined} href="/zh-CN/download/" hrefLang="zh-CN" lang="zh-CN">中文</a></nav></div>
      </header>
      <WebInstallCommand locale={locale} />
      <section className="download-hero"><p className="section-label">{t.eyebrow}</p><h1>{t.title}</h1><p>{t.intro}</p>{release ? <div className="release-meta"><span>{t.version} {release.version}</span><span>{t.published} {new Date(release.publishedAt).toLocaleDateString(isZh ? "zh-CN" : "en-US")}</span></div> : null}</section>
      {release ? <>
        <section className="download-grid"><DownloadCard asset={release.assets.dmg} title={t.macTitle} subtitle={t.macArch} cta={t.macCta} checksum={t.checksum} notice={t.macDownloadNotice}/><DownloadCard asset={release.assets.windowsInstaller} title={t.winTitle} subtitle={t.winArch} cta={t.winCta} checksum={t.checksum} notice={t.winDownloadNotice}/></section>
        <section className="notice-grid">
          <Notice title={t.macWarning} body={t.macBody} steps={t.macSteps} note={t.macNote} links={[{ label: `${t.official} · Apple`, href: APPLE_GUIDE }]}/>
          <Notice title={t.winWarning} body={t.winBody} steps={t.winSteps} note={t.winNote} links={[{ label: `${t.official} · SmartScreen`, href: SMARTSCREEN_GUIDE }, { label: "Smart App Control", href: SMART_APP_CONTROL_GUIDE }]}/>
        </section>
        <div className="release-links"><a href={release.githubReleaseUrl} rel="noreferrer" target="_blank">{t.github} ↗</a><a href={homeHref}>{t.home} ←</a></div>
      </> : <section className="download-fallback"><h2>{t.fallbackTitle}</h2><p>{t.fallbackBody}</p><a className="button static-glass" href={GITHUB_RELEASES}>{t.github}<span>↗</span></a></section>}
    </main>
  );
}
