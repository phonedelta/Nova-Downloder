import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Dev config for HMR of popup/options. Full extension build uses vite.build.mjs */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@nova/shared": resolve(__dirname, "../packages/shared/src"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, "../dist-extension"),
    emptyOutDir: true,
  },
  envDir: __dirname,
});
