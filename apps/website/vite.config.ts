import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "../../build/sites-vite-plugin";

const { d1, r2 } = hostingConfig;

const localBindingConfig = {
  main: "./worker.cloudflare.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1 ? [{ binding: d1, database_name: "hulala", database_id: "00000000-0000-4000-8000-000000000000" }] : [],
  r2_buckets: r2 ? [{ binding: r2, bucket_name: "hulala" }] : [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    plugins: [
      vinext(),
      sites(),
      // The Cloudflare plugin makes the Worker the server entry, which is right
      // for `wrangler deploy` but leaves nothing for the pre-render step to
      // serve. `HULALA_RENDER_ONLY` builds the plain app entry instead.
      ...(process.env.HULALA_RENDER_ONLY === "1" ? [] : [cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] }, config: localBindingConfig })]),
    ],
  };
});
