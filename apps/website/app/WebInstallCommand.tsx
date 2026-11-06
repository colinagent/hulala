"use client";

import { useState } from "react";

const COMMAND = "curl -fsSL https://hulala.ai/install.sh | sh";
const VERSION = "0.2.14";

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
          (zh ? "需要 Node.js 22.13 或更新版本。安装后新开一个终端，运行 hulala 即可连上本机的 Host。" :
            "Requires Node.js 22.13 or newer. Open a new terminal after installing, then run hulala to attach to the Host on your machine.")}
      </p>
    </section>
  );
}
