"use client";

import { useState } from "react";
// The release version is the root manifest, which `release-hulala` bumps; the
// site must never carry a second copy that can drift from the published build.
import { version as VERSION } from "../../../package.json";

const COMMAND = "curl -fsSL https://hulala.ai/install.sh | sh";

export default function WebInstallCommand({ locale }: { locale: "en" | "zh-CN" }) {
  const zh = locale === "zh-CN";
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  return (
    <section className="web-install" aria-label={zh ? "安装 Hulala 终端版" : "Install the Hulala terminal client"}>
      <p className="section-label">Hulala {VERSION} · macOS / Linux</p>
      <div className="web-install-command">
        <code>{COMMAND}</code>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(COMMAND); setStatus("copied"); }
          catch { setStatus("manual"); }
        }} aria-label={zh ? "复制安装命令" : "Copy install command"}>
          {status === "copied" ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}
        </button>
      </div>
      <p className="web-install-help" role="status">
        {status === "manual" ? (zh ? "请选中上方命令并复制。" : "Select and copy the command above.") :
          (zh ? "安装器自带 Node.js 24.9+，无需预装。装完可以直接启动，之后随时运行 hulala。" :
            "The installer supplies Node.js 24.9+ itself. Start it right away, or run hulala later.")}
      </p>
    </section>
  );
}
