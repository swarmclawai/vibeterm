#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const args = process.argv.slice(2);

let token = null;
let requirePassword = false;

function printUsage() {
  console.log("Usage: npm run dev:remote [-- --password] [--token <value>]");
  console.log("");
  console.log("Options:");
  console.log("  --password         Generate and require an access token");
  console.log("  --secure           Alias for --password");
  console.log("  --token <value>    Require this token for remote access");
  console.log("  --token=<value>    Same as above");
  console.log("  -h, --help         Show help");
}

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    printUsage();
    process.exit(0);
  }
  if (arg === "--password" || arg === "--secure") {
    requirePassword = true;
    continue;
  }
  if (arg === "--token") {
    const value = args[i + 1];
    if (!value) {
      console.error("Missing value for --token");
      process.exit(1);
    }
    token = value;
    i += 1;
    continue;
  }
  if (arg.startsWith("--token=")) {
    token = arg.slice("--token=".length);
    if (!token) {
      console.error("Missing value for --token");
      process.exit(1);
    }
    continue;
  }

  console.error(`Unknown option: ${arg}`);
  printUsage();
  process.exit(1);
}

if (requirePassword && !token) {
  token = randomBytes(18).toString("base64url");
}

const backendEnv = { ...process.env };
backendEnv.VIBETERM_REMOTE_REQUIRE_TOKEN = token ? "true" : "false";
if (token) {
  backendEnv.VIBETERM_REMOTE_TOKEN = token;
} else {
  delete backendEnv.VIBETERM_REMOTE_TOKEN;
}
const backendPort = (backendEnv.VIBETERM_REMOTE_PORT || "3030").trim() || "3030";

let shuttingDown = false;
let exitCode = 0;
const children = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function killChildren(signal) {
  for (const child of children) {
    if (child.killed) continue;
    child.kill(signal);
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  process.exitCode = exitCode;
  killChildren("SIGTERM");
  setTimeout(() => {
    killChildren("SIGKILL");
    process.exit(exitCode);
  }, 500);
}

function start(name, npmArgs, env) {
  const child = spawn(npmCmd, npmArgs, {
    env,
    stdio: "inherit",
  });
  children.push(child);

  child.on("error", (error) => {
    console.error(`[dev:remote] ${name} failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const resolvedCode = code ?? (signal ? 1 : 0);
    console.error(
      `[dev:remote] ${name} exited (${signal ?? resolvedCode}), stopping all processes.`,
    );
    shutdown(resolvedCode);
  });

  return child;
}

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));

async function waitForBackendReady(port, timeoutMs = 60_000) {
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const deadline = Date.now() + timeoutMs;

  while (!shuttingDown && Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // Retry until timeout while backend process starts.
    }
    await sleep(500);
  }

  if (shuttingDown) return;
  throw new Error(
    `Remote backend did not become ready at ${healthUrl} within ${Math.floor(timeoutMs / 1000)}s.`,
  );
}

if (token) {
  console.log("[dev:remote] auth: token required");
  console.log(`[dev:remote] open URL: http://<HOST_LAN_IP>:1420/?token=${token}`);
} else {
  console.log("[dev:remote] auth: disabled (no token required)");
  console.log("[dev:remote] open URL: http://<HOST_LAN_IP>:1420/");
}

start("remote backend", ["run", "remote:server"], backendEnv);
try {
  console.log(`[dev:remote] waiting for backend readiness on http://127.0.0.1:${backendPort}/health`);
  await waitForBackendReady(backendPort);
  console.log("[dev:remote] backend ready, starting web UI");
  start("web UI", ["run", "dev:lan"], process.env);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev:remote] ${message}`);
  shutdown(1);
}
