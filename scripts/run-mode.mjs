#!/usr/bin/env node

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  printUsage();
  process.exit(0);
}

const MODES = new Set(["desktop", "web"]);
const maybeMode = rawArgs[0];
const mode = maybeMode && MODES.has(maybeMode) ? maybeMode : "desktop";
const modeArgs = maybeMode && MODES.has(maybeMode) ? rawArgs.slice(1) : rawArgs;
const { launchDirectory, passthrough } = parseArgs(modeArgs);

function printUsage() {
  console.log("Usage: vibeterm [desktop|web] [directory] [--cwd <path>] [--password] [--token <value>]");
  console.log("");
  console.log("Modes:");
  console.log("  desktop        Start the desktop app (default)");
  console.log("  web            Start the remote web mode");
  console.log("");
  console.log("Directory:");
  console.log("  directory      Start with this working directory preselected");
  console.log("  --cwd VALUE    Explicitly set the startup directory");
  console.log("");
  console.log("Options for web mode:");
  console.log("  --password     Require an access token and print it in the terminal");
  console.log("  --token VALUE  Use a specific token instead of generating one");
}

function expandHome(input) {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  return input;
}

function normalizeDirectory(input) {
  if (!input?.trim()) return "";
  const expanded = expandHome(input.trim());
  return resolve(process.cwd(), expanded);
}

function parseArgs(args) {
  const passthrough = [];
  let launchDirectory = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cwd") {
      const value = args[index + 1];
      if (value) {
        launchDirectory = normalizeDirectory(value);
        index += 1;
      }
      continue;
    }
    if (!arg.startsWith("-") && !launchDirectory) {
      launchDirectory = normalizeDirectory(arg);
      continue;
    }
    passthrough.push(arg);
  }

  return {
    launchDirectory,
    passthrough,
  };
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

if (mode === "desktop") {
  const cargoCheck = spawn("cargo", ["--version"], {
    stdio: "ignore",
    env: process.env,
    cwd: packageDir,
  });

  cargoCheck.on("error", () => {
    console.error("Desktop mode requires Rust/Cargo and Tauri desktop prerequisites on this machine.");
    console.error("Install Rust from https://rustup.rs or run `vibeterm web` instead.");
    process.exit(1);
  });

  cargoCheck.on("exit", (code) => {
    if (code !== 0) {
      console.error("Desktop mode requires a working Cargo toolchain on this machine.");
      console.error("Install Rust from https://rustup.rs or run `vibeterm web` instead.");
      process.exit(code ?? 1);
    }

    launch();
  });
} else {
  launch();
}

function launch() {
  const child = spawn(command, commandArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(launchDirectory ? { VIBETERM_START_DIR: launchDirectory } : {}),
    },
    cwd: packageDir,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}
