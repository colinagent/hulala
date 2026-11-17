import { renderToStaticMarkup } from "react-dom/server";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import HomePage from "./app/HomePage";
import type { SiteLocale } from "./app/HomePage";

const out = process.env.PREVIEW_OUT as string;
const site = process.cwd();

mkdirSync(join(out, "assets"), { recursive: true });
mkdirSync(join(out, "screens"), { recursive: true });
mkdirSync(join(out, "zh-CN"), { recursive: true });

for (const name of ["logo.svg", "logo-mark.svg"]) cpSync(join(site, "public", name), join(out, name));
for (const name of ["01-conversation.png", "02-terminal.png", "03-files.png"]) cpSync(join(site, "public", "screens", name), join(out, "screens", name));

const css = readFileSync(join(site, "app", "globals.css"), "utf8").replace(/^@import\s+"tailwindcss";\s*$/m, "");
writeFileSync(join(out, "assets", "new-home.css"), css);

const copyScript = `<script>(function(){var b=document.querySelector('.web-install-command button');var c=document.querySelector('.web-install-command code');if(!b||!c)return;b.addEventListener('click',function(){if(navigator.clipboard)navigator.clipboard.writeText(c.textContent);b.textContent=(document.documentElement.lang.indexOf('zh')>=0)?'已复制':'Copied';});})();</script>`;

function page(locale: SiteLocale, lang: string, title: string): string {
  const body = renderToStaticMarkup(<HomePage locale={locale} />);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/assets/live-base.css"><link rel="stylesheet" href="/assets/new-home.css"></head><body>${body}${copyScript}</body></html>`;
}

writeFileSync(join(out, "index.html"), page("en", "en", "Hulala — the local DeepSeek Harness agent that outlives your terminal window"));
writeFileSync(join(out, "zh-CN", "index.html"), page("zh-CN", "zh-CN", "Hulala 呼啦啦｜关掉窗口，工作照样在跑的本地 Agent"));
console.log("Preview rendered to " + out);
