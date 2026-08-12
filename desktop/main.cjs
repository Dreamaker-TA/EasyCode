const { app, BrowserWindow, dialog, session, shell } = require("electron");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = 32145;
const ORIGIN = `http://${HOST}:${PORT}`;
const STARTUP_TIMEOUT_MS = 120_000;

let backend = null;
let mainWindow = null;
let isQuitting = false;

function backendExecutable() {
  const executable = process.platform === "win32" ? "easycode-backend.exe" : "easycode-backend";
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.join(__dirname, "backend-dist", "easycode-backend");
  return path.join(root, executable);
}

function portIsAvailable() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(PORT, HOST);
  });
}

function startBackend() {
  const executable = backendExecutable();
  backend = spawn(
    executable,
    ["--host", HOST, "--port", String(PORT), "--data-dir", app.getPath("userData")],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  backend.stdout.on("data", (chunk) => console.log(`[backend] ${chunk}`.trimEnd()));
  backend.stderr.on("data", (chunk) => console.error(`[backend] ${chunk}`.trimEnd()));
  backend.once("error", (error) => console.error("Failed to start EasyCode backend", error));
  backend.once("exit", (code, signal) => {
    backend = null;
    if (!isQuitting) {
      void dialog.showErrorBox(
        "EasyCode 本地服务已停止",
        `本地服务意外退出（code=${code ?? "?"}, signal=${signal ?? "?"}）。请重新打开应用。`,
      );
      app.quit();
    }
  });
}

async function waitForBackend() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!backend) throw new Error("The local backend exited during startup.");
    try {
      const response = await fetch(`${ORIGIN}/healthz`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The frozen Python runtime and migrations can take a few seconds on first launch.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out while waiting for the local backend.");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#faf9f7",
    title: "EasyCode",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== ORIGIN) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    if (target.protocol === "https:" || target.protocol === "http:") void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(ORIGIN);
}

function stopBackend() {
  if (!backend) return;
  backend.removeAllListeners("exit");
  backend.kill();
  backend = null;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
            "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        ],
      },
    });
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (!(await portIsAvailable())) {
    dialog.showErrorBox(
      "EasyCode 无法启动",
      `本机端口 ${PORT} 已被其他程序占用。请关闭占用该端口的程序后重试。`,
    );
    app.quit();
    return;
  }

  try {
    startBackend();
    await waitForBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("EasyCode 无法启动", error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow && backend) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopBackend();
});
