import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { staticAssetsAdapter } from "@vinext/cloudflare/cache/static-assets-adapter";
import { rehypeCodeDefaultOptions } from "fumadocs-core/mdx-plugins";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    fumadocsMdx({
      // Shiki has no Caddyfile grammar, which docs/proxies.md uses.
      globalOptions: {
        mdxOptions: {
          rehypeCodeOptions: { ...rehypeCodeDefaultOptions, fallbackLanguage: "text" },
        },
      },
    }),
    vinext({ cache: { cdn: staticAssetsAdapter() }, prerender: { routes: "*" } }),
    cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
  ],
});
