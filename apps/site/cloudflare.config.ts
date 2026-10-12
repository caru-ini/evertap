import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "evertap-site",
    entrypoint: "vinext/server/fetch-handler",
    // No later than the oldest workerd the Vite plugin installs, or `pnpm dev` does not start.
    compatibilityDate: "2026-09-18",
    compatibilityFlags: ["nodejs_compat"],
    // A Custom Domain: Cloudflare creates the DNS record and the certificate on deploy.
    domains: ["evertap.dev"],
    // Only evertap.dev serves the site, not a *.workers.dev address.
    workersDev: false,
    assets: { notFoundHandling: "none", runWorkerFirst: ["/_vinext/static-cache/*"] },
    env: {
      ASSETS: bindings.assets(),
    },
  }),
});
