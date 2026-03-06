mod companions;
mod commands;
pub mod launchers;
mod pty_manager;
pub mod session;
pub mod session_registry;

use session_registry::SessionRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SessionRegistry::new())
        .invoke_handler(tauri::generate_handler![
            commands::create_session,
            commands::write_to_session,
            commands::resize_session,
            commands::kill_session,
            commands::list_sessions,
            commands::update_task,
            commands::list_launchers,
            commands::list_local_shells,
            commands::list_provider_sessions,
            commands::search_directories,
            commands::list_companions,
            commands::open_companion,
            commands::get_session_cwd,
            commands::create_session_in_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
