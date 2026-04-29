const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

app.setName("DataForge");
app.setPath("userData", path.join(app.getPath("appData"), "DataForge"));

const isDev = !app.isPackaged;
const devRendererUrl = process.env.DATAFORGE_RENDERER_URL || "http://127.0.0.1:5173";
const devBackendPort = Number(process.env.DATAFORGE_BACKEND_PORT || "8000");

let backendProcess = null;
let backendBaseUrl = "";
let workspaceRoot = "";
let workspaceState = null;

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function frontendDistDir() {
  return isDev ? path.join(repoRoot(), "frontend", "dist") : path.join(process.resourcesPath, "frontend-dist");
}

function seedTasksDir() {
  return isDev ? path.join(repoRoot(), "tasks") : path.join(process.resourcesPath, "seed", "tasks");
}

function backendExecutable() {
  const executableName = process.platform === "win32" ? "dataforge-backend.exe" : "dataforge-backend";
  return path.join(process.resourcesPath, "backend", "dataforge-backend", executableName);
}

function getWorkspaceRoot() {
  if (isDev) {
    return repoRoot();
  }
  return path.join(app.getPath("documents"), "DataForge");
}

function getLogFilePath() {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, "backend.log");
}

function mergeSeedDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }
  if (path.resolve(sourceDir) === path.resolve(targetDir)) {
    return;
  }
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      mergeSeedDirectory(sourcePath, targetPath);
      continue;
    }
    if (!fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function listTaskNames(tasksDir) {
  if (!fs.existsSync(tasksDir)) {
    return [];
  }
  return fs
    .readdirSync(tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function countRunDirectories(tasksDir) {
  let runCount = 0;
  for (const taskName of listTaskNames(tasksDir)) {
    const runsDir = path.join(tasksDir, taskName, "runs");
    if (!fs.existsSync(runsDir)) {
      continue;
    }
    runCount += fs
      .readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .length;
  }
  return runCount;
}

function ensureWorkspaceSeeded() {
  workspaceRoot = getWorkspaceRoot();
  const workspaceExisted = fs.existsSync(workspaceRoot);
  const tasksDir = path.join(workspaceRoot, "tasks");
  const tasksDirExisted = fs.existsSync(tasksDir);
  const existingTaskNames = listTaskNames(tasksDir);
  const seedTaskNames = listTaskNames(seedTasksDir());

  fs.mkdirSync(workspaceRoot, { recursive: true });
  mergeSeedDirectory(seedTasksDir(), tasksDir);

  const currentTaskNames = listTaskNames(tasksDir);
  const runCount = countRunDirectories(tasksDir);
  const customTaskNames = currentTaskNames.filter((taskName) => !seedTaskNames.includes(taskName));
  workspaceState = {
    justCreated: !workspaceExisted,
    tasksDirWasMissing: !tasksDirExisted,
    hadTasksBeforeSeed: existingTaskNames.length > 0,
    taskCount: currentTaskNames.length,
    runCount,
    seedTaskCount: seedTaskNames.length,
    customTaskCount: customTaskNames.length,
    hasRuns: runCount > 0,
    hasCustomTasks: customTaskNames.length > 0,
    hasOnlySeedTasks: currentTaskNames.length > 0 && customTaskNames.length === 0,
    needsOnboarding: runCount === 0,
  };
}

function getFreePort() {
  if (isDev) {
    return Promise.resolve(devBackendPort);
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve backend port.")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function createBackendCommand(port) {
  if (isDev) {
    return {
      command: "uv",
      args: [
        "run",
        "dataforge-web",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--project-root",
        workspaceRoot,
        "--allow-origin",
        "http://127.0.0.1:5173",
        "--allow-origin",
        "http://localhost:5173",
      ],
      cwd: repoRoot(),
    };
  }

  return {
    command: backendExecutable(),
    args: [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--project-root",
      workspaceRoot,
      "--frontend-dist",
      frontendDistDir(),
    ],
    cwd: workspaceRoot,
  };
}

function attachBackendLogging(child) {
  const stream = fs.createWriteStream(getLogFilePath(), { flags: "a" });
  const pipe = (chunk) => {
    const text = chunk.toString();
    stream.write(text);
    process.stdout.write(text);
  };

  child.stdout?.on("data", pipe);
  child.stderr?.on("data", pipe);
  child.once("exit", () => stream.end());
}

async function waitForBackendReady(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${backendBaseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Backend is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Backend did not become ready within ${timeoutMs}ms.`);
}

async function startBackend() {
  ensureWorkspaceSeeded();
  const port = await getFreePort();
  backendBaseUrl = `http://127.0.0.1:${port}`;
  const backend = createBackendCommand(port);

  backendProcess = spawn(backend.command, backend.args, {
    cwd: backend.cwd,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  attachBackendLogging(backendProcess);

  backendProcess.once("exit", (code) => {
    if (!app.isQuiting && code !== 0) {
      dialog.showErrorBox(
        "DataForge backend exited unexpectedly",
        `The local backend stopped with exit code ${code ?? "unknown"}. Check the backend log for details.\n\n${getLogFilePath()}`
      );
    }
  });

  await waitForBackendReady();
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    return;
  }
  backendProcess.kill();
  backendProcess = null;
}

async function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    show: false,
    webPreferences: {
      additionalArguments: [`--dataforge-backend-base-url=${backendBaseUrl}`],
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (isDev) {
    await mainWindow.loadURL(devRendererUrl);
    return;
  }
  await mainWindow.loadURL(backendBaseUrl);
}

ipcMain.handle("desktop:get-app-info", () => ({
  appVersion: app.getVersion(),
  backendBaseUrl,
  isPackaged: app.isPackaged,
  workspaceRoot,
  logFilePath: getLogFilePath(),
  workspaceState,
}));

ipcMain.handle("desktop:open-path", async (_event, targetPath) => {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    return "Target path is required.";
  }
  return shell.openPath(targetPath);
});

app.on("before-quit", () => {
  app.isQuiting = true;
  stopBackend();
});

app.whenReady().then(async () => {
  try {
    await startBackend();
    await createMainWindow();
  } catch (error) {
    dialog.showErrorBox(
      "Failed to start DataForge desktop",
      error instanceof Error ? error.message : String(error)
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});
