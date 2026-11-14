import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();

console.log("Starting Sti-Key Server and Client...");

const server = spawn("npm", ["run", "dev"], {
  cwd: path.join(rootDir, "server"),
  stdio: "inherit",
  shell: true,
});

const client = spawn("npm", ["run", "dev"], {
  cwd: path.join(rootDir, "client"),
  stdio: "inherit",
  shell: true,
});

function cleanup() {
  server.kill("SIGTERM");
  client.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
