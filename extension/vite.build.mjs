import { build, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const outDir = resolve(root, "../dist-extension");
const shared = resolve(root, "../packages/shared/src");
const env = loadEnv("production", root, "");

const alias = {
  "@nova/shared": shared,
};

/** @type {import('vite').InlineConfig} */
const common = {
  root,
  configFile: false,
  publicDir: false,
  plugins: [react()],
  resolve: { alias },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.VITE_NOVA_API_BASE_URL": JSON.stringify(
      env.VITE_NOVA_API_BASE_URL || "http://127.0.0.1:3001",
    ),
    "import.meta.env.VITE_NOVA_PUBLIC_DOWNLOAD_BASE_URL": JSON.stringify(
      env.VITE_NOVA_PUBLIC_DOWNLOAD_BASE_URL ||
        env.VITE_NOVA_API_BASE_URL ||
        "http://127.0.0.1:3001",
    ),
    "import.meta.env.VITE_NOVA_WEB_BASE_URL": JSON.stringify(
      env.VITE_NOVA_WEB_BASE_URL || "http://127.0.0.1:5173",
    ),
    "import.meta.env.VITE_NOVA_DEBUG": JSON.stringify(env.VITE_NOVA_DEBUG || "1"),
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "import.meta.env.MODE": JSON.stringify("production"),
  },
  envDir: root,
};

function rewriteHtml(srcPath, destName) {
  if (!existsSync(srcPath)) return;
  let html = readFileSync(srcPath, "utf8");
  html = html.replace(/(src|href)="\/([^"]+)"/g, '$1="./$2"');
  html = html.replace(/(src|href)="\.\.\/\.\.\/assets\//g, '$1="./assets/');
  writeFileSync(resolve(outDir, destName), html);
}

async function buildExtension() {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Content script — YouTube only (unchanged entry)
  await build({
    ...common,
    build: {
      outDir,
      emptyOutDir: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: resolve(root, "src/content/main.tsx"),
        output: {
          format: "iife",
          name: "NovaDownloaderContent",
          entryFileNames: "content.js",
          inlineDynamicImports: true,
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  });

  // Generic web-video content script (non-YouTube pages)
  await build({
    ...common,
    build: {
      outDir,
      emptyOutDir: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: resolve(root, "src/content/generic/main.tsx"),
        output: {
          format: "iife",
          name: "NovaDownloaderGeneric",
          entryFileNames: "content-generic.js",
          inlineDynamicImports: true,
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  });

  // Site bridge (tiny)
  await build({
    ...common,
    build: {
      outDir,
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(root, "src/content/siteBridge.ts"),
        output: {
          format: "iife",
          name: "NovaSiteBridge",
          entryFileNames: "site-bridge.js",
          inlineDynamicImports: true,
        },
      },
    },
  });

  // Service worker — ES module
  await build({
    ...common,
    build: {
      outDir: resolve(outDir, "background"),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(root, "src/background/service-worker.ts"),
        output: {
          format: "es",
          entryFileNames: "service-worker.js",
          inlineDynamicImports: true,
        },
      },
    },
  });

  // Popup + options
  await build({
    ...common,
    base: "./",
    build: {
      outDir,
      emptyOutDir: false,
      rollupOptions: {
        input: {
          popup: resolve(root, "src/popup/popup.html"),
          options: resolve(root, "src/options/options.html"),
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  });

  rewriteHtml(resolve(outDir, "src/popup/popup.html"), "popup.html");
  rewriteHtml(resolve(outDir, "src/options/options.html"), "options.html");

  // Clean nested src copy if present
  const nestedSrc = resolve(outDir, "src");
  if (existsSync(nestedSrc)) rmSync(nestedSrc, { recursive: true, force: true });

  const manifest = JSON.parse(
    readFileSync(resolve(root, "manifest.json"), "utf8"),
  );
  const apiBase = env.VITE_NOVA_API_BASE_URL || "http://127.0.0.1:3001";
  const publicDownloadBase =
    env.VITE_NOVA_PUBLIC_DOWNLOAD_BASE_URL || apiBase;

  // Production store builds must not ship localhost / Docker-internal hosts
  if (env.VITE_NOVA_ENV === "production") {
    const blocked = /localhost|127\.0\.0\.1|\bbackend\b|\b\/\/api:|\/\/server:/i;
    if (blocked.test(apiBase) || blocked.test(publicDownloadBase)) {
      throw new Error(
        `Production extension build refused: API URL must be a public host (got ${apiBase}).`,
      );
    }
  }

  try {
    const u = new URL(apiBase);
    const originPattern = `${u.protocol}//${u.host}/*`;
    if (!manifest.host_permissions.includes(originPattern)) {
      manifest.host_permissions.push(originPattern);
    }
  } catch {
    /* keep defaults */
  }
  writeFileSync(
    resolve(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const iconsSrc = resolve(root, "public/icons");
  const iconsDst = resolve(outDir, "icons");
  mkdirSync(iconsDst, { recursive: true });
  if (existsSync(iconsSrc)) cpSync(iconsSrc, iconsDst, { recursive: true });

  console.log("Extension built → dist-extension/");
}

buildExtension().catch((err) => {
  console.error(err);
  process.exit(1);
});
