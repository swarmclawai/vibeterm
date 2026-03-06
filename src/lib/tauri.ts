import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface TaskMetadata {
  label: string;
  status: "running" | "idle" | "errored" | "completed";
}

export interface SessionInfo {
  id: string;
  task: TaskMetadata;
  pid: number | null;
  launcher_id: string;
  launcher_label: string;
  resume_mode: string;
  provider_session_id: string;
}

export interface CompanionInfo {
  id: string;
  label: string;
  kind: string;
  source: string;
  supportsUrl: boolean;
  aliases: string[];
  available: boolean;
}

export interface LaunchRequest {
  launcherId?: string;
  shellId?: string;
  resumeMode?: "new" | "last" | "session";
  providerSessionId?: string;
}

export interface LauncherInfo {
  id: string;
  label: string;
  supportsResume: boolean;
  localOnly: boolean;
  available: boolean;
}

export interface LocalShellInfo {
  id: string;
  label: string;
  command: string;
  args: string[];
  isDefault: boolean;
}

export interface ProviderSessionInfo {
  id: string;
  label: string;
  updatedAt: string;
}

export interface DirectoryMatch {
  path: string;
  label: string;
  iconPath?: string | null;
}

type RuntimeMode = "tauri" | "remote" | "none";

const DEFAULT_REMOTE_PORT = "3030";
const REMOTE_STORAGE_TOKEN_KEY = "vibeterm_remote_token";
const NETWORK_ERROR_HINT =
  'Start the backend with "npm run remote:server" and verify your remote URL/token settings.';

const REMOTE_BASE_URL = resolveRemoteBaseUrl();
const RUNTIME_MODE: RuntimeMode = isTauri()
  ? "tauri"
  : REMOTE_BASE_URL
    ? "remote"
    : "none";

type OutputListener = (data: string) => void;
type ExitListener = () => void;

const remoteOutputListeners = new Map<string, Set<OutputListener>>();
const remoteExitListeners = new Map<string, Set<ExitListener>>();
let remoteWs: WebSocket | null = null;
let reconnectTimer: number | null = null;

export function isTauriRuntime(): boolean {
  return RUNTIME_MODE === "tauri";
}

export function getTerminalRuntime(): RuntimeMode {
  return RUNTIME_MODE;
}

export function hasTerminalRuntime(): boolean {
  return RUNTIME_MODE !== "none";
}

function ensureRuntime(command: string) {
  if (RUNTIME_MODE === "none") {
    throw new Error(
      `No terminal runtime available for "${command}". Set VITE_VIBETERM_REMOTE_URL (or run inside Tauri).`,
    );
  }
}

function resolveRemoteBaseUrl(): string | null {
  const envUrl = normalizeRemoteUrl(
    (import.meta.env.VITE_VIBETERM_REMOTE_URL as string | undefined) ?? "",
  );
  if (envUrl) return envUrl;
  if (typeof window === "undefined") return null;

  if (import.meta.env.DEV) {
    return window.location.origin.replace(/\/+$/, "");
  }

  const locationUrl = new URL(window.location.href);
  if (!locationUrl.hostname) return null;

  const envPort =
    (import.meta.env.VITE_VIBETERM_REMOTE_PORT as string | undefined)?.trim();
  const port = envPort || DEFAULT_REMOTE_PORT;
  locationUrl.port = port;
  locationUrl.pathname = "";
  locationUrl.search = "";
  locationUrl.hash = "";
  return locationUrl.origin;
}

function normalizeRemoteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function resolveRemoteToken(): string | null {
  const envToken = (import.meta.env.VITE_VIBETERM_REMOTE_TOKEN as string | undefined)?.trim();
  if (envToken) return envToken;
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const queryToken = params.get("token")?.trim();
  if (queryToken) {
    try {
      window.localStorage.setItem(REMOTE_STORAGE_TOKEN_KEY, queryToken);
    } catch {
      // Ignore storage failures.
    }
    return queryToken;
  }

  try {
    const stored = window.localStorage.getItem(REMOTE_STORAGE_TOKEN_KEY)?.trim();
    return stored || null;
  } catch {
    return null;
  }
}

async function remoteRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!REMOTE_BASE_URL) {
    throw new Error("Remote backend URL is not configured.");
  }
  const url = `${REMOTE_BASE_URL}${path}`;
  const token = resolveRemoteToken();

  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not reach terminal backend at ${url}. ${reason}. ${NETWORK_ERROR_HINT}`,
    );
  }
  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Remote request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function remoteWsUrl(): string {
  if (!REMOTE_BASE_URL) {
    throw new Error("Remote backend URL is not configured.");
  }
  const url = new URL(REMOTE_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/events/ws";
  url.search = "";
  const token = resolveRemoteToken();
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
}

function hasRemoteSubscribers(): boolean {
  for (const listeners of remoteOutputListeners.values()) {
    if (listeners.size > 0) return true;
  }
  for (const listeners of remoteExitListeners.values()) {
    if (listeners.size > 0) return true;
  }
  return false;
}

function ensureRemoteSocket() {
  if (RUNTIME_MODE !== "remote" || typeof window === "undefined") return;
  if (!hasRemoteSubscribers()) return;
  if (remoteWs && (remoteWs.readyState === WebSocket.OPEN || remoteWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const socket = new WebSocket(remoteWsUrl());
  remoteWs = socket;

  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    handleRemoteEvent(event.data);
  };

  socket.onclose = () => {
    remoteWs = null;
    if (!hasRemoteSubscribers()) return;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      ensureRemoteSocket();
    }, 1000);
  };

  socket.onerror = () => {
    socket.close();
  };
}

function maybeCloseRemoteSocket() {
  if (RUNTIME_MODE !== "remote" || typeof window === "undefined") return;
  if (hasRemoteSubscribers()) return;
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (remoteWs) {
    remoteWs.close();
    remoteWs = null;
  }
}

function handleRemoteEvent(payload: string) {
  let parsed: {
    type?: string;
    session_id?: string;
    data?: string;
  };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }

  if (!parsed.type || !parsed.session_id) return;
  if (parsed.type === "pty_output" && typeof parsed.data === "string") {
    const listeners = remoteOutputListeners.get(parsed.session_id);
    if (!listeners) return;
    for (const callback of listeners) {
      callback(parsed.data);
    }
    return;
  }
  if (parsed.type === "session_exit") {
    const listeners = remoteExitListeners.get(parsed.session_id);
    if (!listeners) return;
    for (const callback of listeners) {
      callback();
    }
  }
}

export async function createSession(
  label?: string,
  launchConfig?: LaunchRequest,
): Promise<SessionInfo> {
  ensureRuntime("create_session");
  if (RUNTIME_MODE === "tauri") {
    return invoke("create_session", { label, launchConfig });
  }
  return remoteRequest<SessionInfo>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      label,
      launch_config: launchConfig,
    }),
  });
}

export async function writeToSession(
  id: string,
  data: string,
): Promise<void> {
  ensureRuntime("write_to_session");
  if (RUNTIME_MODE === "tauri") {
    return invoke("write_to_session", { id, data });
  }
  await remoteRequest<void>(`/api/sessions/${encodeURIComponent(id)}/write`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function resizeSession(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  ensureRuntime("resize_session");
  if (RUNTIME_MODE === "tauri") {
    return invoke("resize_session", { id, cols, rows });
  }
  await remoteRequest<void>(`/api/sessions/${encodeURIComponent(id)}/resize`, {
    method: "POST",
    body: JSON.stringify({ cols, rows }),
  });
}

export async function killSession(id: string): Promise<void> {
  ensureRuntime("kill_session");
  if (RUNTIME_MODE === "tauri") {
    return invoke("kill_session", { id });
  }
  await remoteRequest<void>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function listSessions(): Promise<SessionInfo[]> {
  ensureRuntime("list_sessions");
  if (RUNTIME_MODE === "tauri") {
    return invoke("list_sessions");
  }
  return remoteRequest<SessionInfo[]>("/api/sessions", {
    method: "GET",
  });
}

export async function updateTask(
  id: string,
  label?: string,
  status?: TaskMetadata["status"],
): Promise<SessionInfo> {
  ensureRuntime("update_task");
  if (RUNTIME_MODE === "tauri") {
    return invoke("update_task", { id, label, status });
  }
  return remoteRequest<SessionInfo>(
    `/api/sessions/${encodeURIComponent(id)}/task`,
    {
      method: "PATCH",
      body: JSON.stringify({ label, status }),
    },
  );
}

export async function getSessionCwd(id: string): Promise<string> {
  ensureRuntime("get_session_cwd");
  if (RUNTIME_MODE === "tauri") {
    return invoke("get_session_cwd", { id });
  }
  return remoteRequest<string>(`/api/sessions/${encodeURIComponent(id)}/cwd`, {
    method: "GET",
  });
}

export async function createSessionInDir(
  label?: string,
  cwd?: string,
  launchConfig?: LaunchRequest,
): Promise<SessionInfo> {
  ensureRuntime("create_session_in_dir");
  if (RUNTIME_MODE === "tauri") {
    return invoke("create_session_in_dir", { label, cwd, launchConfig });
  }
  return remoteRequest<SessionInfo>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      label,
      cwd,
      launch_config: launchConfig,
    }),
  });
}

export async function listLaunchers(): Promise<LauncherInfo[]> {
  if (RUNTIME_MODE !== "tauri") {
    return [];
  }
  return invoke("list_launchers");
}

export async function listLocalShells(): Promise<LocalShellInfo[]> {
  if (RUNTIME_MODE !== "tauri") {
    return [];
  }
  return invoke("list_local_shells");
}

export async function listProviderSessions(
  launcherId: string,
  projectRoot?: string,
): Promise<ProviderSessionInfo[]> {
  if (RUNTIME_MODE !== "tauri") {
    return [];
  }
  return invoke("list_provider_sessions", { launcherId, projectRoot });
}

export async function searchDirectories(
  query: string,
  limit = 12,
): Promise<DirectoryMatch[]> {
  if (RUNTIME_MODE !== "tauri") {
    return [];
  }
  return invoke("search_directories", { query, limit });
}

export async function getLaunchDirectory(): Promise<string | null> {
  if (RUNTIME_MODE !== "tauri") {
    return null;
  }
  return invoke<string | null>("get_launch_directory");
}

export async function listCompanions(): Promise<CompanionInfo[]> {
  if (RUNTIME_MODE !== "tauri") {
    return [];
  }
  return invoke("list_companions");
}

export async function openCompanion(
  id: string,
  url?: string,
): Promise<void> {
  if (RUNTIME_MODE !== "tauri") {
    throw new Error("Native companion apps are only available in Tauri desktop mode.");
  }
  return invoke("open_companion", { id, url });
}

export function onPtyOutput(
  sessionId: string,
  callback: (data: string) => void,
): Promise<UnlistenFn> {
  ensureRuntime(`pty-output-${sessionId}`);
  if (RUNTIME_MODE === "tauri") {
    return listen<string>(`pty-output-${sessionId}`, (event) => {
      callback(event.payload);
    });
  }

  let listeners = remoteOutputListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    remoteOutputListeners.set(sessionId, listeners);
  }
  listeners.add(callback);
  ensureRemoteSocket();

  return Promise.resolve(() => {
    const set = remoteOutputListeners.get(sessionId);
    if (!set) return;
    set.delete(callback);
    if (set.size === 0) {
      remoteOutputListeners.delete(sessionId);
    }
    maybeCloseRemoteSocket();
  });
}

export function onSessionExit(
  sessionId: string,
  callback: () => void,
): Promise<UnlistenFn> {
  ensureRuntime(`session-exit-${sessionId}`);
  if (RUNTIME_MODE === "tauri") {
    return listen(`session-exit-${sessionId}`, () => {
      callback();
    });
  }

  let listeners = remoteExitListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    remoteExitListeners.set(sessionId, listeners);
  }
  listeners.add(callback);
  ensureRemoteSocket();

  return Promise.resolve(() => {
    const set = remoteExitListeners.get(sessionId);
    if (!set) return;
    set.delete(callback);
    if (set.size === 0) {
      remoteExitListeners.delete(sessionId);
    }
    maybeCloseRemoteSocket();
  });
}
