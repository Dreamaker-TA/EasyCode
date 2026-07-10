import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

// self-host Pyodide 运行时（零 CDN）。源在 node_modules/pyodide（版本由 package.json 锁定）。
// - dev：中间件直接服务 /pyodide/*；
// - build：emit 到 dist/pyodide/*。
// 关键：**不放进 public/**——pyodide loader 内部用 `import(indexURL + "pyodide.asm.mjs")` 加载，
// 而 Vite dev 禁止源码 import() 落在 public/ 的文件（会报 "should not be imported from source code"）。
// 经中间件从 node_modules 服务即绕开该守卫，dev/build 行为一致。
const PYODIDE_FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
];

function pyodideSelfHost(): Plugin {
  const dir = path.resolve(__dirname, "node_modules/pyodide");
  const mimeOf = (name: string) =>
    name.endsWith(".wasm")
      ? "application/wasm" // instantiateStreaming 要求 application/wasm
      : name.endsWith(".mjs")
        ? "text/javascript"
        : name.endsWith(".json")
          ? "application/json"
          : "application/octet-stream";
  return {
    name: "pyodide-self-host",
    // 同步注册 → 排在 Vite 内置 transform 中间件之前，先行拦截 /pyodide/* 的 import() 请求。
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith("/pyodide/")) return next();
        const name = url.slice("/pyodide/".length);
        if (!PYODIDE_FILES.includes(name)) return next();
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) return next();
        res.setHeader("Content-Type", mimeOf(name));
        res.setHeader("Cache-Control", "no-cache");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of PYODIDE_FILES) {
        this.emitFile({
          type: "asset",
          fileName: `pyodide/${name}`,
          source: fs.readFileSync(path.join(dir, name)),
        });
      }
    },
  };
}

export default defineConfig({
  envDir: path.resolve(__dirname, ".."),
  plugins: [react(), pyodideSelfHost()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules/monaco-editor/") ||
            id.includes("node_modules/@monaco-editor/react/")
          ) {
            return "monaco-editor";
          }
        },
      },
    },
  },
});
