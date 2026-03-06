use crate::launchers::{
    build_spawn_config, launcher_display_label, normalize_launch_request, LaunchRequest,
};
use crate::pty_manager::{spawn_pty, PtyHandle};
use crate::session::{SessionInfo, TaskMetadata, TaskStatus};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use portable_pty::PtySize;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEvent {
    PtyOutput { session_id: String, data: String },
    SessionExit { session_id: String },
}

pub type SessionEventSink = Arc<dyn Fn(SessionEvent) + Send + Sync>;

struct LiveSession {
    info: SessionInfo,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
}

pub struct SessionRegistry {
    sessions: Arc<Mutex<HashMap<String, LiveSession>>>,
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create(
        &self,
        app: &AppHandle,
        label: Option<String>,
        launch_request: Option<LaunchRequest>,
    ) -> Result<SessionInfo, String> {
        self.create_in_dir(app, label, None, launch_request)
    }

    pub fn create_in_dir(
        &self,
        app: &AppHandle,
        label: Option<String>,
        cwd: Option<String>,
        launch_request: Option<LaunchRequest>,
    ) -> Result<SessionInfo, String> {
        let app_handle = app.clone();
        let sink: SessionEventSink = Arc::new(move |event| match event {
            SessionEvent::PtyOutput { session_id, data } => {
                let _ = app_handle.emit(&format!("pty-output-{}", session_id), data);
            }
            SessionEvent::SessionExit { session_id } => {
                let _ = app_handle.emit(&format!("session-exit-{}", session_id), ());
            }
        });

        self.create_with_event_sink(label, cwd, Some(sink), launch_request)
    }

    pub fn create_with_event_sink(
        &self,
        label: Option<String>,
        cwd: Option<String>,
        event_sink: Option<SessionEventSink>,
        launch_request: Option<LaunchRequest>,
    ) -> Result<SessionInfo, String> {
        let launch_config = normalize_launch_request(launch_request);
        let spawn_config = build_spawn_config(&launch_config);
        let id = Uuid::new_v4().to_string();

        let PtyHandle {
            master,
            writer,
            mut reader,
            child_pid,
        } = spawn_pty(&spawn_config.command, &spawn_config.args, 80, 24, cwd.as_deref())?;

        let info = SessionInfo {
            id: id.clone(),
            task: TaskMetadata {
                label: label.unwrap_or_else(|| "Terminal".to_string()),
                status: TaskStatus::Running,
            },
            pid: child_pid,
            launcher_id: launch_config.launcher_id.clone(),
            launcher_label: launcher_display_label(&launch_config),
            resume_mode: launch_config.resume_mode.clone(),
            provider_session_id: launch_config.provider_session_id.clone(),
        };

        let session = LiveSession {
            info: info.clone(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(master)),
        };

        self.sessions
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), session);

        // Spawn reader thread for PTY output
        let session_id = id.clone();
        let sessions_ref = self.sessions.clone();
        let sink_for_thread = event_sink.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        // Update status to completed
                        if let Ok(mut sessions) = sessions_ref.lock() {
                            if let Some(s) = sessions.get_mut(&session_id) {
                                s.info.task.status = TaskStatus::Completed;
                            }
                        }
                        if let Some(sink) = &sink_for_thread {
                            sink(SessionEvent::SessionExit {
                                session_id: session_id.clone(),
                            });
                        }
                        break;
                    }
                    Ok(n) => {
                        if let Some(sink) = &sink_for_thread {
                            sink(SessionEvent::PtyOutput {
                                session_id: session_id.clone(),
                                data: BASE64.encode(&buf[..n]),
                            });
                        }
                    }
                }
            }
        });

        Ok(info)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(id).ok_or("Session not found")?;
        let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
        writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {}", e))?;
        writer.flush().map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(id).ok_or("Session not found")?;
        let master = session.master.lock().map_err(|e| e.to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        // Dropping the session closes the master PTY, which signals the child
        sessions.remove(id);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Result<SessionInfo, String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get(id).ok_or("Session not found")?;
        Ok(session.info.clone())
    }

    pub fn list(&self) -> Result<Vec<SessionInfo>, String> {
        let sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        Ok(sessions.values().map(|s| s.info.clone()).collect())
    }

    pub fn update_task(
        &self,
        id: &str,
        label: Option<String>,
        status: Option<TaskStatus>,
    ) -> Result<SessionInfo, String> {
        let mut sessions = self.sessions.lock().map_err(|e| e.to_string())?;
        let session = sessions.get_mut(id).ok_or("Session not found")?;
        if let Some(l) = label {
            session.info.task.label = l;
        }
        if let Some(s) = status {
            session.info.task.status = s;
        }
        Ok(session.info.clone())
    }
}
