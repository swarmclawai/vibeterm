use crate::companions::{self, CompanionInfo};
use crate::launchers::{
    self, DirectorySearchResult, LaunchRequest, LauncherInfo, LocalShell, ProviderSessionInfo,
};
use crate::session::{SessionInfo, TaskStatus};
use crate::session_registry::SessionRegistry;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn create_session(
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
    label: Option<String>,
    launch_config: Option<LaunchRequest>,
) -> Result<SessionInfo, String> {
    registry.create(&app, label, launch_config)
}

#[tauri::command]
pub fn write_to_session(
    registry: State<'_, SessionRegistry>,
    id: String,
    data: String,
) -> Result<(), String> {
    registry.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn resize_session(
    registry: State<'_, SessionRegistry>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry.resize(&id, cols, rows)
}

#[tauri::command]
pub fn kill_session(registry: State<'_, SessionRegistry>, id: String) -> Result<(), String> {
    registry.kill(&id)
}

#[tauri::command]
pub fn list_sessions(registry: State<'_, SessionRegistry>) -> Result<Vec<SessionInfo>, String> {
    registry.list()
}

#[tauri::command]
pub fn update_task(
    registry: State<'_, SessionRegistry>,
    id: String,
    label: Option<String>,
    status: Option<TaskStatus>,
) -> Result<SessionInfo, String> {
    registry.update_task(&id, label, status)
}

#[tauri::command]
pub fn create_session_in_dir(
    app: AppHandle,
    registry: State<'_, SessionRegistry>,
    label: Option<String>,
    cwd: String,
    launch_config: Option<LaunchRequest>,
) -> Result<SessionInfo, String> {
    registry.create_in_dir(&app, label, Some(cwd), launch_config)
}

#[tauri::command]
pub fn list_launchers() -> Result<Vec<LauncherInfo>, String> {
    Ok(launchers::list_launchers())
}

#[tauri::command]
pub fn list_local_shells() -> Result<Vec<LocalShell>, String> {
    Ok(launchers::list_local_shells())
}

#[tauri::command]
pub fn list_provider_sessions(
    launcher_id: String,
    project_root: Option<String>,
) -> Result<Vec<ProviderSessionInfo>, String> {
    Ok(launchers::list_provider_sessions(
        &launcher_id,
        project_root.as_deref(),
    ))
}

#[tauri::command]
pub fn search_directories(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<DirectorySearchResult>, String> {
    Ok(launchers::search_directories(
        &query,
        limit.unwrap_or(12),
    ))
}

#[tauri::command]
pub fn list_companions() -> Result<Vec<CompanionInfo>, String> {
    Ok(companions::list_companions())
}

#[tauri::command]
pub fn open_companion(id: String, url: Option<String>) -> Result<(), String> {
    companions::open_companion(&id, url.as_deref())
}

#[tauri::command]
pub fn get_session_cwd(registry: State<'_, SessionRegistry>, id: String) -> Result<String, String> {
    let session = registry.get(&id)?;
    let pid = session.pid.ok_or_else(|| "No PID".to_string())?;
    get_cwd_for_pid(pid as i32)
}

#[cfg(target_os = "macos")]
fn get_cwd_for_pid(pid: i32) -> Result<String, String> {
    let output = std::process::Command::new("lsof")
        .args(["-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .map_err(|e| format!("lsof failed: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix('n') {
            return Ok(path.to_string());
        }
    }
    Err("Could not determine cwd".to_string())
}

#[cfg(target_os = "linux")]
fn get_cwd_for_pid(pid: i32) -> Result<String, String> {
    std::fs::read_link(format!("/proc/{}/cwd", pid))
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to read cwd: {}", e))
}

#[cfg(target_os = "windows")]
fn get_cwd_for_pid(pid: i32) -> Result<String, String> {
    // Use PowerShell to query the process CWD via .NET reflection
    let script = format!(
        "[System.Diagnostics.Process]::GetProcessById({}).MainModule.FileName",
        pid
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NoLogo", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell failed: {}", e))?;
    if !output.status.success() {
        return Err("PowerShell command failed".to_string());
    }
    let exe_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if exe_path.is_empty() {
        return Err("Could not determine process path".to_string());
    }
    // Return the parent directory of the executable
    std::path::Path::new(&exe_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine cwd".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn get_cwd_for_pid(_pid: i32) -> Result<String, String> {
    Err("CWD detection not supported on this platform".to_string())
}
