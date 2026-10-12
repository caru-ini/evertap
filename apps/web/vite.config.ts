import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { DtsCreator } from "typed-css-modules/lib/dts-creator.js";
import { defineConfig, type Plugin } from "vite";

// dev only: the Bun server (:8080) answers /api; in production it also serves this build
const SERVER_DEV_URL = "http://127.0.0.1:8080";

// Writes <package>/.css-types/**/x.module.d.css.ts for each CSS module, so `styles.` completes in the
// editor; tsconfig rootDirs overlays that folder on src.
const cssModuleTypes = (): Plugin => {
  const creators = new Map<string, DtsCreator>();
  return {
    name: "css-module-types",
    async transform(_code, id) {
      const file = id.split("?")[0];
      if (!file?.endsWith(".module.css")) return;
      const rootDir = file.slice(0, file.lastIndexOf("/src/"));
      let creator = creators.get(rootDir);
      if (!creator) {
        creator = new DtsCreator({
          rootDir,
          searchDir: "src",
          outDir: ".css-types",
          allowArbitraryExtensions: true,
        });
        creators.set(rootDir, creator);
      }
      const types = await creator.create(file, undefined, true);
      await types.writeFile();
    },
  };
};

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": SERVER_DEV_URL,
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    cssModuleTypes(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
