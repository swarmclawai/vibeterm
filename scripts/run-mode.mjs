#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}
const mode = (args[0] && !args[0].startsWith("-")) ? args[0] : "desktop";
const passthrough = mode === "desktop" ? args.slice(1) : args.slice(1);

function printUsage() {
  console.log("Usage: vibeterm [desktop|web] [--password] [--token <value>]");
  console.log("");
  console.log("Modes:");
  console.log("  desktop        Start the desktop app (default)");
  console.log("  web            Start the remote web mode");
  console.log("");
  console.log("Options for web mode:");
  console.log("  --password     Require an access token and print it in the terminal");
  console.log("  --token VALUE  Use a specific token instead of generating one");
}

let childArgs;
if (mode === "desktop") {
  childArgs = [npmCmd, ["run", "desktop:dev"]];
} else if (mode === "web") {
  childArgs = [
    process.execPath,
    [resolve(scriptDir, "dev-remote.mjs"), ...passthrough],
  ];
} else {
  console.error(`Unknown mode: ${mode}`);
  printUsage();
  process.exit(1);
}

const [command, commandArgs] = childArgs;
const child = spawn(command, commandArgs, {
  stdio: "inherit",
  env: process.env,
  cwd: packageDir,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
