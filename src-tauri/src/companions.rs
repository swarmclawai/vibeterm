use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub source: String,
    pub supports_url: bool,
    pub aliases: Vec<String>,
    pub available: bool,
}

#[derive(Debug, Clone)]
struct DetectedCompanion {
    info: CompanionInfo,
    open_target: PathBuf,
}

#[derive(Debug, Clone)]
struct ScannedBundle {
    label: String,
    path: PathBuf,
}

#[derive(Clone, Copy)]
struct KnownCompanion {
    id: &'static str,
    label: &'static str,
    kind: &'static str,
    supports_url: bool,
    aliases: &'static [&'static str],
    bundles: &'static [&'static str],
}

const KNOWN_COMPANIONS: &[KnownCompanion] = &[
    KnownCompanion {
        id: "chrome",
        label: "Google Chrome",
        kind: "browser",
        supports_url: true,
        aliases: &["browser", "google", "web"],
        bundles: &["Google Chrome.app"],
    },
    KnownCompanion {
        id: "spotify",
        label: "Spotify",
        kind: "media",
        supports_url: true,
        aliases: &["music", "audio"],
        bundles: &["Spotify.app"],
    },
    KnownCompanion {
        id: "chatgpt",
        label: "ChatGPT",
        kind: "assistant",
        supports_url: false,
        aliases: &["ai", "assistant"],
        bundles: &["ChatGPT.app"],
    },
    KnownCompanion {
        id: "claude",
        label: "Claude",
        kind: "assistant",
        supports_url: false,
        aliases: &["ai", "assistant"],
        bundles: &["Claude.app"],
    },
    KnownCompanion {
        id: "slack",
        label: "Slack",
        kind: "chat",
        supports_url: false,
        aliases: &["team", "messages"],
        bundles: &["Slack.app"],
    },
    KnownCompanion {
        id: "discord",
        label: "Discord",
        kind: "chat",
        supports_url: false,
        aliases: &["voice", "community"],
        bundles: &["Discord.app"],
    },
    KnownCompanion {
        id: "figma",
        label: "Figma",
        kind: "design",
        supports_url: false,
        aliases: &["design", "prototype"],
        bundles: &["Figma.app"],
    },
    KnownCompanion {
        id: "cursor",
        label: "Cursor",
        kind: "code",
        supports_url: false,
        aliases: &["editor", "ide"],
        bundles: &["Cursor.app"],
    },
    KnownCompanion {
        id: "vscode",
        label: "Visual Studio Code",
        kind: "code",
        supports_url: false,
        aliases: &["code", "editor", "ide"],
        bundles: &["Visual Studio Code.app", "Code.app"],
    },
];

pub fn list_companions() -> Vec<CompanionInfo> {
    detect_companions()
        .into_iter()
        .map(|companion| companion.info)
        .collect()
}

pub fn open_companion(id: &str, url: Option<&str>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let companion = detect_companions()
            .into_iter()
            .find(|companion| companion.info.id == id)
            .ok_or_else(|| "Companion app is not installed".to_string())?;

        let mut command = Command::new("open");
        command.arg("-a").arg(&companion.open_target);

        if companion.info.supports_url {
            let normalized = normalize_companion_url(url.unwrap_or_default());
            if !normalized.is_empty() {
                command.arg(normalized);
            }
        }

        command
            .spawn()
            .map_err(|error| format!("Failed to open companion app: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        let _ = url;
        Err("Companion apps are only supported in desktop mode on macOS for now.".to_string())
    }
}

fn detect_companions() -> Vec<DetectedCompanion> {
    #[cfg(target_os = "macos")]
    {
        let scanned = scan_mac_applications();
        let bundles_by_name: HashMap<String, ScannedBundle> = scanned
            .iter()
            .cloned()
            .map(|bundle| (format!("{}.app", bundle.label).to_lowercase(), bundle))
            .collect();

        let mut seen_ids = HashSet::new();
        let mut seen_paths = HashSet::new();
        let mut companions = Vec::new();

        for known in KNOWN_COMPANIONS {
            let bundle_match = known
                .bundles
                .iter()
                .find_map(|bundle_name| bundles_by_name.get(&bundle_name.to_lowercase()));

            let Some(bundle) = bundle_match.cloned() else {
                continue;
            };

            seen_ids.insert(known.id.to_string());
            seen_paths.insert(bundle.path.clone());
            companions.push(DetectedCompanion {
                info: CompanionInfo {
                    id: known.id.to_string(),
                    label: known.label.to_string(),
                    kind: known.kind.to_string(),
                    source: "bundle".to_string(),
                    supports_url: known.supports_url,
                    aliases: known.aliases.iter().map(|alias| (*alias).to_string()).collect(),
                    available: true,
                },
                open_target: bundle.path,
            });
        }

        for bundle in scanned {
            if seen_paths.contains(&bundle.path) {
                continue;
            }

            let id = unique_companion_id(slugify_label(&bundle.label), &mut seen_ids);
            companions.push(DetectedCompanion {
                info: CompanionInfo {
                    id,
                    label: bundle.label,
                    kind: "app".to_string(),
                    source: "bundle".to_string(),
                    supports_url: false,
                    aliases: Vec::new(),
                    available: true,
                },
                open_target: bundle.path,
            });
        }

        companions.sort_by(|left, right| left.info.label.cmp(&right.info.label));
        return companions;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "macos")]
fn scan_mac_applications() -> Vec<ScannedBundle> {
    let mut apps = Vec::new();
    let mut seen = HashSet::new();

    let mut roots = vec![PathBuf::from("/Applications"), PathBuf::from("/System/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(Path::new(&home).join("Applications"));
    }

    for root in roots {
        if !root.exists() {
            continue;
        }

        for bundle in walk_mac_application_bundles(&root, 2) {
            if !seen.insert(bundle.clone()) {
                continue;
            }

            let label = bundle
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("App")
                .to_string();

            apps.push(ScannedBundle { label, path: bundle });
        }
    }

    apps
}

#[cfg(target_os = "macos")]
fn walk_mac_application_bundles(root: &Path, depth: usize) -> Vec<PathBuf> {
    let mut bundles = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return bundles;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("app") {
            bundles.push(path);
            continue;
        }

        if depth == 0 {
            continue;
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            bundles.extend(walk_mac_application_bundles(&path, depth.saturating_sub(1)));
        }
    }

    bundles
}

fn unique_companion_id(base_id: String, seen_ids: &mut HashSet<String>) -> String {
    let fallback = if base_id.is_empty() {
        "app".to_string()
    } else {
        base_id
    };
    let mut next_id = fallback.clone();
    let mut counter = 2;

    while seen_ids.contains(&next_id) {
        next_id = format!("{fallback}-{counter}");
        counter += 1;
    }

    seen_ids.insert(next_id.clone());
    next_id
}

fn slugify_label(label: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

fn normalize_companion_url(input: &str) -> String {
    let raw = input.trim();
    if raw.is_empty() {
        return String::new();
    }

    let lowercase = raw.to_ascii_lowercase();
    if lowercase.starts_with("http://")
        || lowercase.starts_with("https://")
        || lowercase.starts_with("mailto:")
    {
        return raw.to_string();
    }

    if raw.starts_with("//") {
        return format!("https:{raw}");
    }

    if raw.contains('.') && !raw.contains(' ') && !raw.contains('/') {
        return format!("https://{raw}");
    }

    if raw.contains('.') && !raw.contains(' ') {
        return format!("https://{raw}");
    }

    String::new()
}
