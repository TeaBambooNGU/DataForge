import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const sourceTasksDir = path.join(projectRoot, "tasks");
const outputTasksDir = path.join(projectRoot, "dist", "seed", "tasks");

fs.rmSync(outputTasksDir, { force: true, recursive: true });
fs.mkdirSync(outputTasksDir, { recursive: true });

for (const entry of fs.readdirSync(sourceTasksDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const taskName = entry.name;
  const sourceTaskDir = path.join(sourceTasksDir, taskName);
  const targetTaskDir = path.join(outputTasksDir, taskName);
  fs.mkdirSync(targetTaskDir, { recursive: true });

  const configsDir = path.join(sourceTaskDir, "configs");
  if (fs.existsSync(configsDir)) {
    fs.cpSync(configsDir, path.join(targetTaskDir, "configs"), { recursive: true });
  }

  const readmeFile = path.join(sourceTaskDir, "README.md");
  if (fs.existsSync(readmeFile)) {
    fs.copyFileSync(readmeFile, path.join(targetTaskDir, "README.md"));
  }
}
