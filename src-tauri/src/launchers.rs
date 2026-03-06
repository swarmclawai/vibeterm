use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalShell {
    pub id: String,
    pub label: String,
    pub command: String,
    pub args: Vec<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherInfo {
    pub id: String,
    pub label: String,
    pub supports_resume: bool,
    pub local_only: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSessionInfo {
    pub id: String,
    pub label: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySearchResult {
    pub path: String,
    pub label: String,
    pub icon_path: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub launcher_id: Option<String>,
    pub shell_id: Option<String>,
    pub resume_mode: Option<String>,
    pub provider_session_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LaunchConfig {
    pub launcher_id: String,
    pub shell_id: String,
    pub resume_mode: String,
    pub provider_session_id: String,
}

#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone)]
struct LauncherDefinition {
    id: &'static str,
    label: &'static str,
    command_name: &'static str,
    local_only: bool,
    supports_resume: bool,
}

const LAUNCHERS: &[LauncherDefinition] = &[
    LauncherDefinition {
        id: "shell",
        label: "Shell",
        command_name: "",
        local_only: false,
        supports_resume: false,
    },
    LauncherDefinition {
        id: "codex",
        label: "Codex CLI",
        command_name: "codex",
        local_only: true,
        supports_resume: true,
    },
    LauncherDefinition {
        id: "claude",
        label: "Claude CLI",
        command_name: "claude",
        local_only: true,
        supports_resume: true,
    },
    LauncherDefinition {
        id: "gemini",
        label: "Gemini CLI",
        command_name: "gemini",
        local_only: true,
        supports_resume: true,
    },
    LauncherDefinition {
        id: "opencode",
        label: "OpenCode CLI",
        command_name: "opencode",
        local_only: true,
        supports_resume: true,
    },
];

pub fn list_local_shells() -> Vec<LocalShell> {
    discover_local_shells()
}

pub fn list_launchers() -> Vec<LauncherInfo> {
    LAUNCHERS
        .iter()
        .map(|launcher| {
            let available = launcher.id == "shell" || !find_command_in_path(launcher.command_name).is_empty();
            LauncherInfo {
                id: launcher.id.to_string(),
                label: launcher.label.to_string(),
                supports_resume: launcher.supports_resume,
                local_only: launcher.local_only,
                available,
            }
        })
        .filter(|launcher| launcher.available)
        .collect()
}

pub fn list_provider_sessions(
    launcher_id: &str,
    project_root: Option<&str>,
) -> Vec<ProviderSessionInfo> {
    let root = project_root
        .map(PathBuf::from)
        .or_else(current_project_root)
        .unwrap_or_else(home_dir_fallback);

    match launcher_id {
        "codex" => parse_codex_recent_sessions(12),
        "claude" => parse_claude_recent_sessions(&root, 12),
        "gemini" => parse_gemini_recent_sessions(&root, 12),
        "opencode" => parse_opencode_recent_sessions(12),
        _ => Vec::new(),
    }
}

pub fn search_directories(query: &str, limit: usize) -> Vec<DirectorySearchResult> {
    let trimmed = query.trim();
    let normalized_query = normalize_directory_query(trimmed);
    let search_limit = limit.clamp(1, 24);
    let mut seen = HashSet::new();
    let mut matches = Vec::new();

    for candidate_path in global_directory_candidates(trimmed, search_limit.saturating_mul(6)) {
        if let Some(candidate) = build_directory_match(&candidate_path, &normalized_query) {
            let key = candidate.path.clone();
            if seen.insert(key) {
                matches.push(candidate);
            }
        }
    }

    let roots = search_roots_for_query(trimmed);
    if roots.is_empty() {
        return matches
            .into_iter()
            .take(search_limit)
            .map(|candidate| DirectorySearchResult {
                path: candidate.path,
                label: candidate.label,
                icon_path: candidate.icon_path,
            })
            .collect();
    }

    let mut scanned_dirs = 0usize;
    let scan_budget = 1_800usize;
    let max_depth = 5usize;

    for root in &roots {
        if scanned_dirs >= scan_budget {
            break;
        }

        if let Some(candidate) = build_directory_match(root, &normalized_query) {
            let key = candidate.path.clone();
            if seen.insert(key) {
                matches.push(candidate);
            }
        }

        let mut queue = BinaryHeap::new();
        queue.push(Reverse((0usize, root.clone())));

        while let Some(Reverse((depth, path))) = queue.pop() {
            if scanned_dirs >= scan_budget || depth > max_depth {
                break;
            }
            scanned_dirs += 1;

            let Ok(entries) = fs::read_dir(&path) else {
                continue;
            };

            for entry in entries.flatten() {
                if scanned_dirs >= scan_budget {
                    break;
                }

                let child_path = entry.path();
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                if !metadata.is_dir() {
                    continue;
                }
                if is_hidden_directory(&child_path) {
                    continue;
                }

                if let Some(candidate) = build_directory_match(&child_path, &normalized_query) {
                    let key = candidate.path.clone();
                    if seen.insert(key) {
                        matches.push(candidate);
                    }
                }

                if depth + 1 <= max_depth {
                    queue.push(Reverse((depth + 1, child_path)));
                }
            }
        }
    }

    matches.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.label.to_lowercase().cmp(&right.label.to_lowercase()))
            .then_with(|| left.path.cmp(&right.path))
    });
    matches.truncate(search_limit);

    matches
        .into_iter()
        .map(|candidate| DirectorySearchResult {
            path: candidate.path,
            label: candidate.label,
            icon_path: candidate.icon_path,
        })
        .collect()
}

pub fn normalize_launch_request(request: Option<LaunchRequest>) -> LaunchConfig {
    let shells = discover_local_shells();
    let default_shell = shells
        .iter()
        .find(|shell| shell.is_default)
        .cloned()
        .or_else(|| shells.first().cloned())
        .unwrap_or(LocalShell {
            id: "shell".to_string(),
            label: "zsh (default)".to_string(),
            command: env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
            args: vec!["-l".to_string()],
            is_default: true,
        });

    let Some(request) = request else {
        return LaunchConfig {
            launcher_id: "shell".to_string(),
            shell_id: default_shell.id,
            resume_mode: "new".to_string(),
            provider_session_id: String::new(),
        };
    };

    let available_launchers = list_launchers();
    let launcher_id = request
        .launcher_id
        .as_deref()
        .map(|value| sanitize_identifier(value, "shell"))
        .filter(|id| available_launchers.iter().any(|launcher| launcher.id == *id))
        .unwrap_or_else(|| "shell".to_string());

    let shell_id = request
        .shell_id
        .as_deref()
        .map(|value| sanitize_identifier(value, default_shell.id.as_str()))
        .filter(|id| shells.iter().any(|shell| shell.id == *id || shell.command == *id))
        .unwrap_or(default_shell.id);

    let supports_resume = available_launchers
        .iter()
        .find(|launcher| launcher.id == launcher_id)
        .map(|launcher| launcher.supports_resume)
        .unwrap_or(false);

    let resume_mode = if supports_resume {
        normalize_resume_mode(request.resume_mode.as_deref())
    } else {
        "new".to_string()
    };

    let provider_session_id = if resume_mode == "session" {
        clean_label_text(request.provider_session_id.as_deref().unwrap_or_default(), "")
    } else {
        String::new()
    };

    LaunchConfig {
        launcher_id,
        shell_id,
        resume_mode: if resume_mode == "session" && provider_session_id.is_empty() {
            "new".to_string()
        } else {
            resume_mode
        },
        provider_session_id,
    }
}

pub fn build_spawn_config(config: &LaunchConfig) -> SpawnConfig {
    if config.launcher_id == "shell" {
        let shell = resolve_local_shell(&config.shell_id);
        return SpawnConfig {
            command: shell.command,
            args: shell.args,
        };
    }

    let command = LAUNCHERS
        .iter()
        .find(|launcher| launcher.id == config.launcher_id)
        .and_then(|launcher| {
            let resolved = find_command_in_path(launcher.command_name);
            if resolved.is_empty() {
                None
            } else {
                Some(resolved)
            }
        })
        .unwrap_or_else(|| resolve_local_shell("").command);

    let args = match config.launcher_id.as_str() {
        "codex" => match config.resume_mode.as_str() {
            "last" => vec!["resume".to_string(), "--last".to_string()],
            "session" => vec!["resume".to_string(), config.provider_session_id.clone()],
            _ => Vec::new(),
        },
        "claude" => match config.resume_mode.as_str() {
            "last" => vec!["-c".to_string()],
            "session" => vec!["-r".to_string(), config.provider_session_id.clone()],
            _ => Vec::new(),
        },
        "gemini" => match config.resume_mode.as_str() {
            "last" => vec!["--resume".to_string(), "latest".to_string()],
            "session" => vec!["--resume".to_string(), config.provider_session_id.clone()],
            _ => Vec::new(),
        },
        "opencode" => match config.resume_mode.as_str() {
            "last" => vec!["-c".to_string()],
            "session" => vec!["-s".to_string(), config.provider_session_id.clone()],
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };

    SpawnConfig { command, args }
}

pub fn launcher_display_label(config: &LaunchConfig) -> String {
    if config.launcher_id == "shell" {
        return resolve_local_shell(&config.shell_id).label;
    }

    LAUNCHERS
        .iter()
        .find(|launcher| launcher.id == config.launcher_id)
        .map(|launcher| launcher.label.to_string())
        .unwrap_or_else(|| "Shell".to_string())
}

fn discover_local_shells() -> Vec<LocalShell> {
    let mut shells = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let mut candidates = vec![
        env::var("SHELL").unwrap_or_default(),
        "zsh".to_string(),
        "bash".to_string(),
        "sh".to_string(),
        "fish".to_string(),
        "nu".to_string(),
        "ksh".to_string(),
        "tcsh".to_string(),
        "csh".to_string(),
        "dash".to_string(),
    ];
    candidates.retain(|candidate| !candidate.trim().is_empty());

    let default_shell = env::var("SHELL").unwrap_or_default();

    for candidate in candidates {
        let command = if Path::new(&candidate).is_absolute() {
            if Path::new(&candidate).exists() {
                candidate
            } else {
                continue;
            }
        } else {
            let found = find_command_in_path(&candidate);
            if found.is_empty() {
                continue;
            }
            found
        };

        if !seen.insert(command.clone()) {
            continue;
        }

        let is_default = command == default_shell;
        let name = Path::new(&command)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("shell");
        let label = if is_default {
            format!("{name} (default)")
        } else {
            name.to_string()
        };

        shells.push(LocalShell {
            id: sanitize_identifier(name, "shell"),
            label,
            command: command.clone(),
            args: shell_args_for_command(&command),
            is_default,
        });
    }

    shells
}

#[derive(Debug, Clone)]
struct RankedDirectoryMatch {
    path: String,
    label: String,
    icon_path: Option<String>,
    score: i32,
}

fn resolve_local_shell(shell_id: &str) -> LocalShell {
    let shells = discover_local_shells();
    let default_shell = shells
        .iter()
        .find(|shell| shell.is_default)
        .cloned()
        .or_else(|| shells.first().cloned())
        .unwrap_or(LocalShell {
            id: "shell".to_string(),
            label: "zsh (default)".to_string(),
            command: env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
            args: vec!["-l".to_string()],
            is_default: true,
        });

    if shell_id.trim().is_empty() {
        return default_shell;
    }

    shells
        .into_iter()
        .find(|shell| shell.id == shell_id || shell.command == shell_id)
        .unwrap_or(default_shell)
}

fn shell_args_for_command(command: &str) -> Vec<String> {
    let name = Path::new(command)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if cfg!(target_os = "windows") {
        return Vec::new();
    }

    if name == "nu" || name == "elvish" {
        return Vec::new();
    }

    vec!["-l".to_string()]
}

fn find_command_in_path(command: &str) -> String {
    let raw = command.trim();
    if raw.is_empty() {
        return String::new();
    }

    let command_path = Path::new(raw);
    if command_path.is_absolute() {
        return if command_path.exists() {
            raw.to_string()
        } else {
            String::new()
        };
    }

    let mut search_paths = Vec::new();
    if let Some(path_var) = env::var_os("PATH") {
        search_paths.extend(env::split_paths(&path_var));
    }
    search_paths.extend(common_bin_search_roots());

    let mut seen = HashSet::new();
    for entry in search_paths {
        if !seen.insert(entry.clone()) {
            continue;
        }
        let candidate = entry.join(raw);
        if candidate.is_file() {
            return candidate.to_string_lossy().to_string();
        }
    }

    if let Some(found) = find_command_with_login_shell(raw) {
        return found;
    }

    String::new()
}

fn common_bin_search_roots() -> Vec<PathBuf> {
    let home = home_dir();
    let mut roots = vec![
        home.join(".local").join("bin"),
        home.join(".cargo").join("bin"),
        home.join(".bun").join("bin"),
        home.join("bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ];

    let nvm_versions_dir = home.join(".nvm").join("versions").join("node");
    if let Ok(entries) = fs::read_dir(nvm_versions_dir) {
        for entry in entries.flatten() {
            let bin_dir = entry.path().join("bin");
            if bin_dir.is_dir() {
                roots.push(bin_dir);
            }
        }
    }

    roots
}

fn find_command_with_login_shell(command: &str) -> Option<String> {
    #[cfg(target_family = "unix")]
    {
        if !command
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/'))
        {
            return None;
        }

        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let output = std::process::Command::new(shell)
            .args(["-lc", &format!("command -v {command}")])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }

        let resolved = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or_default()
            .trim()
            .to_string();
        if resolved.is_empty() {
            None
        } else {
            Some(resolved)
        }
    }

    #[cfg(not(target_family = "unix"))]
    {
        let _ = command;
        None
    }
}

fn normalize_resume_mode(value: Option<&str>) -> String {
    match value.unwrap_or_default().trim().to_ascii_lowercase().as_str() {
        "last" | "session" => value.unwrap().trim().to_ascii_lowercase(),
        _ => "new".to_string(),
    }
}

fn sanitize_identifier(value: &str, fallback: &str) -> String {
    let filtered: String = value
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | ':' | '@' | '-'))
        .take(100)
        .collect();
    if filtered.is_empty() {
        fallback.to_string()
    } else {
        filtered
    }
}

fn normalize_directory_query(query: &str) -> String {
    let expanded = expand_home_query(query);
    expanded
        .trim()
        .trim_end_matches(std::path::MAIN_SEPARATOR)
        .to_ascii_lowercase()
}

fn expand_home_query(query: &str) -> String {
    if query == "~" {
        return home_dir().to_string_lossy().to_string();
    }
    if let Some(rest) = query.strip_prefix("~/") {
        return home_dir().join(rest).to_string_lossy().to_string();
    }
    query.to_string()
}

fn search_roots_for_query(query: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();

    let expanded = expand_home_query(query);
    let expanded_path = PathBuf::from(expanded.clone());
    if !query.trim().is_empty() {
        for candidate in query_seed_paths(&expanded_path) {
            if candidate.is_dir() && seen.insert(candidate.clone()) {
                roots.push(candidate);
            }
        }
    }

    for candidate in common_project_roots() {
        if candidate.is_dir() && seen.insert(candidate.clone()) {
            roots.push(candidate);
        }
    }

    roots
}

fn global_directory_candidates(query: &str, limit: usize) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();

    for path in spotlight_directory_candidates(query, limit) {
        if seen.insert(path.clone()) {
            results.push(path);
        }
    }

    results
}

#[cfg(target_os = "macos")]
fn spotlight_directory_candidates(query: &str, limit: usize) -> Vec<PathBuf> {
    let trimmed = query.trim();
    if trimmed.is_empty() || limit == 0 {
        return Vec::new();
    }

    let escaped = trimmed.replace('\\', "\\\\").replace('"', "\\\"");
    let expression = format!(
        r#"kMDItemFSName == "*{escaped}*"cd || kMDItemPath == "*{escaped}*"cd"#
    );

    let output = std::process::Command::new("mdfind")
        .arg("-0")
        .arg(expression)
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    output
        .stdout
        .split(|byte| *byte == 0)
        .filter_map(|chunk| {
            if chunk.is_empty() {
                return None;
            }
            let path = PathBuf::from(String::from_utf8_lossy(chunk).to_string());
            if !path.is_dir() || is_hidden_directory(&path) {
                return None;
            }
            Some(path)
        })
        .take(limit)
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn spotlight_directory_candidates(_query: &str, _limit: usize) -> Vec<PathBuf> {
    Vec::new()
}

fn query_seed_paths(path: &Path) -> Vec<PathBuf> {
    let mut seeds = Vec::new();
    if path.is_dir() {
        seeds.push(path.to_path_buf());
    }

    let mut current = if path.is_dir() {
        Some(path.to_path_buf())
    } else {
        path.parent().map(Path::to_path_buf)
    };

    while let Some(candidate) = current {
        if candidate.is_dir() {
            seeds.push(candidate.clone());
            break;
        }
        current = candidate.parent().map(Path::to_path_buf);
    }

    seeds
}

fn common_project_roots() -> Vec<PathBuf> {
    let home = home_dir();
    let mut roots = vec![
        home.clone(),
        home.join("Dev"),
        home.join("Developer"),
        home.join("Code"),
        home.join("Projects"),
        home.join("Documents"),
        home.join("Work"),
    ];
    let volumes = PathBuf::from("/Volumes");
    if volumes.is_dir() {
      roots.push(volumes);
    }
    if let Ok(current_dir) = env::current_dir() {
        roots.push(current_dir);
    }
    roots
}

fn build_directory_match(path: &Path, normalized_query: &str) -> Option<RankedDirectoryMatch> {
    if !path.is_dir() {
        return None;
    }

    let resolved_path = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    let normalized_path = resolved_path
        .to_string_lossy()
        .trim_end_matches(std::path::MAIN_SEPARATOR)
        .to_string();
    let label = resolved_path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| resolved_path.to_string_lossy().to_string());
    let score = directory_match_score(&label, &normalized_path, normalized_query);
    if score <= 0 {
        return None;
    }

    Some(RankedDirectoryMatch {
        path: normalized_path,
        label,
        icon_path: detect_directory_icon(&resolved_path)
            .map(|value| value.to_string_lossy().to_string()),
        score,
    })
}

fn directory_match_score(label: &str, path: &str, normalized_query: &str) -> i32 {
    if normalized_query.is_empty() {
        return 10;
    }

    let normalized_label = label.to_ascii_lowercase();
    let normalized_path = path.to_ascii_lowercase();

    if normalized_path == normalized_query || normalized_label == normalized_query {
        return 140;
    }
    if normalized_path.starts_with(&normalized_query) {
        return 130;
    }
    if normalized_label.starts_with(&normalized_query) {
        return 120;
    }
    if normalized_label.contains(&normalized_query) {
        return 90;
    }
    if normalized_path.contains(&normalized_query) {
        return 70;
    }

    0
}

fn detect_directory_icon(path: &Path) -> Option<PathBuf> {
    let candidates = [
        path.join("favicon.ico"),
        path.join("favicon.png"),
        path.join("icon.png"),
        path.join("logo.png"),
        path.join("public").join("favicon.ico"),
        path.join("public").join("favicon.png"),
        path.join("app").join("favicon.ico"),
        path.join("src-tauri").join("icons").join("32x32.png"),
        path.join("src-tauri").join("icons").join("128x128.png"),
    ];

    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn is_hidden_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

fn clean_label_text(value: &str, fallback: &str) -> String {
    let cleaned = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(100)
        .collect::<String>();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn path_slug(input_path: &Path) -> String {
    input_path
        .to_string_lossy()
        .replace(['/', '\\'], "-")
}

fn session_summary_shape(id: String, label: String, updated_at: String) -> ProviderSessionInfo {
    let fallback = if id.len() >= 8 {
        format!("Session {}", &id[..8])
    } else {
        "Session".to_string()
    };
    ProviderSessionInfo {
        id: clean_label_text(&id, ""),
        label: clean_label_text(&label, &fallback),
        updated_at,
    }
}

fn parse_codex_recent_sessions(limit: usize) -> Vec<ProviderSessionInfo> {
    let history_path = home_dir().join(".codex").join("history.jsonl");
    let Ok(content) = fs::read_to_string(history_path) else {
        return Vec::new();
    };

    let mut seen = std::collections::HashSet::new();
    let mut sessions = Vec::new();

    for line in content.lines().rev() {
        if sessions.len() >= limit {
            break;
        }
        let Ok(parsed) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let session_id = parsed
            .get("session_id")
            .and_then(Value::as_str)
            .map(|value| clean_label_text(value, ""))
            .unwrap_or_default();
        if session_id.is_empty() || !seen.insert(session_id.clone()) {
            continue;
        }

        let updated_at = parsed
            .get("ts")
            .and_then(Value::as_f64)
            .map(|value| {
                chrono_like_iso_from_unix(value as i64).unwrap_or_default()
            })
            .unwrap_or_default();
        let label = parsed
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("Codex session");
        sessions.push(session_summary_shape(session_id, label.to_string(), updated_at));
    }

    sessions
}

fn parse_claude_recent_sessions(project_root: &Path, limit: usize) -> Vec<ProviderSessionInfo> {
    let project_dir = home_dir()
        .join(".claude")
        .join("projects")
        .join(path_slug(project_root));
    let Ok(entries) = fs::read_dir(project_dir) else {
        return Vec::new();
    };

    let mut files = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            Some((path, metadata.modified().ok()))
        })
        .collect::<Vec<_>>();

    files.sort_by(|left, right| right.1.cmp(&left.1));

    let mut sessions = Vec::new();
    for (path, modified) in files.into_iter().take(limit * 3) {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Some(first_line) = content.lines().find(|line| !line.trim().is_empty()) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<Value>(first_line) else {
            continue;
        };
        let session_id = parsed
            .get("sessionId")
            .and_then(Value::as_str)
            .map(|value| clean_label_text(value, ""))
            .unwrap_or_default();
        if session_id.is_empty() {
            continue;
        }
        let label = extract_claude_text(&parsed)
            .or_else(|| parsed.get("slug").and_then(Value::as_str).map(ToString::to_string))
            .unwrap_or_else(|| "Claude session".to_string());
        let updated_at = modified
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| chrono_like_iso_from_unix(value.as_secs() as i64).unwrap_or_default())
            .unwrap_or_default();

        sessions.push(session_summary_shape(session_id, label, updated_at));
        if sessions.len() >= limit {
            break;
        }
    }

    sessions
}

fn extract_claude_text(record: &Value) -> Option<String> {
    let content = record.get("message")?.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let array = content.as_array()?;
    array
        .iter()
        .find_map(|part| {
            if part.get("type").and_then(Value::as_str) == Some("text") {
                part.get("text").and_then(Value::as_str).map(ToString::to_string)
            } else {
                None
            }
        })
}

fn parse_gemini_recent_sessions(project_root: &Path, limit: usize) -> Vec<ProviderSessionInfo> {
    let project_name = project_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("project");
    let project_dir = home_dir()
        .join(".gemini")
        .join("tmp")
        .join(project_name)
        .join("chats");
    let Ok(entries) = fs::read_dir(project_dir) else {
        return Vec::new();
    };

    let mut sessions = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = path.file_name()?.to_str()?.to_string();
            if !file_name.starts_with("session-") || path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            let content = fs::read_to_string(&path).ok()?;
            let parsed = serde_json::from_str::<Value>(&content).ok()?;
            let metadata = entry.metadata().ok()?;
            let session_id = parsed
                .get("sessionId")
                .and_then(Value::as_str)
                .map(|value| clean_label_text(value, ""))
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| {
                    file_name
                        .trim_start_matches("session-")
                        .trim_end_matches(".json")
                        .to_string()
                });
            let label = extract_gemini_text(parsed.get("messages"))
                .unwrap_or_else(|| "Gemini session".to_string());
            let updated_at = parsed
                .get("lastUpdated")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_else(|| {
                    metadata
                        .modified()
                        .ok()
                        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                        .and_then(|value| chrono_like_iso_from_unix(value.as_secs() as i64))
                        .unwrap_or_default()
                });
            Some(session_summary_shape(session_id, label, updated_at))
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    sessions.truncate(limit);
    sessions
}

fn extract_gemini_text(messages: Option<&Value>) -> Option<String> {
    let messages = messages?.as_array()?;
    for message in messages {
        if message.get("type").and_then(Value::as_str) != Some("user") {
            continue;
        }
        let Some(parts) = message.get("content").and_then(Value::as_array) else {
            continue;
        };
        let text = parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" ");
        if !text.trim().is_empty() {
            return Some(text);
        }
    }
    None
}

fn parse_opencode_recent_sessions(limit: usize) -> Vec<ProviderSessionInfo> {
    let sessions_dir = home_dir()
        .join(".local")
        .join("share")
        .join("opencode")
        .join("storage")
        .join("session_diff");
    let Ok(entries) = fs::read_dir(sessions_dir) else {
        return Vec::new();
    };

    let mut sessions = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = path.file_name()?.to_str()?.to_string();
            if !file_name.starts_with("ses_") || path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            let session_id = file_name.trim_end_matches(".json").to_string();
            let updated_at = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .and_then(|value| chrono_like_iso_from_unix(value.as_secs() as i64))
                .unwrap_or_default();
            let tail = if session_id.len() > 8 {
                &session_id[session_id.len() - 8..]
            } else {
                session_id.as_str()
            };
            Some(session_summary_shape(
                session_id.clone(),
                format!("OpenCode {tail}"),
                updated_at,
            ))
        })
        .collect::<Vec<_>>();

    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    sessions.truncate(limit);
    sessions
}

fn current_project_root() -> Option<PathBuf> {
    env::current_dir().ok()
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn home_dir_fallback() -> PathBuf {
    home_dir()
}

fn chrono_like_iso_from_unix(seconds: i64) -> Option<String> {
    use std::time::{Duration, UNIX_EPOCH};
    let time = UNIX_EPOCH.checked_add(Duration::from_secs(seconds.max(0) as u64))?;
    let datetime = time
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())?;
    // Lightweight RFC3339-ish UTC formatting without adding a chrono dependency.
    // This mirrors the sortable ISO strings used by the original app closely enough.
    let output = CommandDateTime::from_unix(datetime)?;
    Some(output)
}

struct CommandDateTime;

impl CommandDateTime {
    fn from_unix(seconds: u64) -> Option<String> {
        #[cfg(target_family = "unix")]
        {
            use std::process::Command;
            let output = Command::new("date")
                .args(["-u", "-r", &seconds.to_string(), "+%Y-%m-%dT%H:%M:%SZ"])
                .output()
                .ok()?;
            if !output.status.success() {
                return None;
            }
            return Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }

        #[cfg(not(target_family = "unix"))]
        {
            let _ = seconds;
            None
        }
    }
}
