import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const entryFile = path.resolve(__dirname, "backend_entry.py");

const result = spawnSync(
  "uv",
  [
    "run",
    "--with",
    "pyinstaller",
    "pyinstaller",
    entryFile,
    "--name",
    "dataforge-backend",
    "--clean",
    "--noconfirm",
    "--onedir",
    "--distpath",
    path.join(projectRoot, "dist", "backend"),
    "--workpath",
    path.join(projectRoot, "dist", "backend-build"),
    "--specpath",
    path.join(projectRoot, "dist", "backend-spec"),
    "--paths",
    path.join(projectRoot, "src"),
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
