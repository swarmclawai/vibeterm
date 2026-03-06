use std::sync::Arc;

use axum::extract::{
    ws::{Message, WebSocket, WebSocketUpgrade},
    Path, Query, State,
};
use axum::http::{header::AUTHORIZATION, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use vibeterm_lib::launchers::LaunchRequest;
use vibeterm_lib::session::{SessionInfo, TaskStatus};
use vibeterm_lib::session_registry::{SessionEvent, SessionEventSink, SessionRegistry};

#[derive(Clone)]
struct AppState {
    registry: Arc<SessionRegistry>,
    events: broadcast::Sender<SessionEvent>,
    auth_token: Option<Arc<String>>,
    auth_required: bool,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }

    fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "Unauthorized. Provide a valid token.",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, self.message).into_response()
    }
}

#[derive(Debug, Deserialize, Default)]
struct AuthQuery {
    token: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug, Deserialize)]
struct CreateSessionRequest {
    label: Option<String>,
    cwd: Option<String>,
    #[serde(default)]
    launch_config: Option<LaunchRequest>,
}

#[derive(Debug, Deserialize)]
struct WriteRequest {
    data: String,
}

#[derive(Debug, Deserialize)]
struct ResizeRequest {
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskRequest {
    label: Option<String>,
    status: Option<TaskStatus>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let host = std::env::var("VIBETERM_REMOTE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = std::env::var("VIBETERM_REMOTE_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(3030);
    let token = std::env::var("VIBETERM_REMOTE_TOKEN").ok().and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let auth_required = parse_bool_env("VIBETERM_REMOTE_REQUIRE_TOKEN").unwrap_or(false)
        || token.is_some();
    if auth_required && token.is_none() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "VIBETERM_REMOTE_REQUIRE_TOKEN is true, but VIBETERM_REMOTE_TOKEN is missing",
        )
        .into());
    }

    let registry = Arc::new(SessionRegistry::new());
    let (events, _) = broadcast::channel::<SessionEvent>(4096);
    let state = AppState {
        registry,
        events,
        auth_token: token.map(Arc::new),
        auth_required,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ]);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/events/ws", get(events_ws))
        .route("/api/sessions", get(list_sessions).post(create_session))
        .route("/api/sessions/{id}", delete(kill_session))
        .route("/api/sessions/{id}/write", post(write_session))
        .route("/api/sessions/{id}/resize", post(resize_session))
        .route("/api/sessions/{id}/task", patch(update_task))
        .route("/api/sessions/{id}/cwd", get(session_cwd))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind((host.as_str(), port)).await?;
    println!(
        "vibeterm remote server listening on http://{}:{}",
        host, port
    );
    println!("websocket endpoint: ws://{}:{}/api/events/ws", host, port);
    if auth_required {
        println!("auth mode: token required");
    } else {
        println!("auth mode: disabled (no token required)");
    }
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
    Json(request): Json<CreateSessionRequest>,
) -> Result<Json<SessionInfo>, ApiError> {
    ensure_authorized(&state, &headers, &query)?;
    let tx = state.events.clone();
    let sink: SessionEventSink = Arc::new(move |event| {
        let _ = tx.send(event);
    });
    let info = state
        .registry
        .create_with_event_sink(request.label, request.cwd, Some(sink), request.launch_config)
        .map_err(internal_error)?;
    Ok(Json(info))
}

async fn list_sessions(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
) -> Result<Json<Vec<SessionInfo>>, ApiError> {
    ensure_authorized(&state, &headers, &query)?;
    let sessions = state.registry.list().map_err(internal_error)?;
    Ok(Json(sessions))
}

async fn write_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
    Path(id): Path<String>,
    Json(request): Json<WriteRequest>,
) -> Result<StatusCode, ApiError> {
    ensure_authorized(&state, &headers, &query)?;
    state
        .registry
        .write(&id, request.data.as_bytes())
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn resize_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
    Path(id): Path<String>,
    Json(request): Json<ResizeRequest>,
) -> Result<StatusCode, ApiError> {
    ensure_authorized(&state, &headers, &query)?;
    state
        .registry
        .resize(&id, request.cols, request.rows)
        .map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
    Path(id): Path<String>,
    Json(request): Json<UpdateTaskRequest>,
) -> Result<Json<SessionInfo>, ApiError> {
    ensure_authorized(&state, &headers, &query)?;
    let updated = state
        .registry
        .update_task(&id, request.label, request.status)
        .map_err(internal_error)?;
    Ok(Json(updated))
}

async fn kill_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    ensure_authorized(&state, &headers, &query)?;
    state.registry.kill(&id).map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn session_cwd(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
    Path(id): Path<String>,
) -> Result<Json<String>, ApiError> {
    ensure_authorized(&state, &headers, &query)?;
    let session = state.registry.get(&id).map_err(internal_error)?;
    let pid = session
        .pid
        .ok_or_else(|| internal_error("No PID".to_string()))?;
    let cwd = get_cwd_for_pid(pid as i32).map_err(internal_error)?;
    Ok(Json(cwd))
}

async fn events_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Query<AuthQuery>,
) -> Result<Response, ApiError> {
    ensure_authorized(&state, &headers, &query)?;
    let receiver = state.events.subscribe();
    Ok(ws.on_upgrade(move |socket| handle_ws(socket, receiver)))
}

async fn handle_ws(mut socket: WebSocket, mut receiver: broadcast::Receiver<SessionEvent>) {
    loop {
        tokio::select! {
            maybe_message = socket.recv() => {
                match maybe_message {
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(_)) => {}
                }
            }
            event = receiver.recv() => {
                match event {
                    Ok(event) => {
                        match serde_json::to_string(&event) {
                            Ok(payload) => {
                                if socket.send(Message::Text(payload.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

fn ensure_authorized(
    state: &AppState,
    headers: &HeaderMap,
    query: &AuthQuery,
) -> Result<(), ApiError> {
    if !state.auth_required {
        return Ok(());
    }

    let supplied = query
        .token
        .clone()
        .or_else(|| extract_bearer_token(headers));
    match (&state.auth_token, supplied) {
        (Some(expected), Some(value)) if value == expected.as_str() => Ok(()),
        _ => Err(ApiError::unauthorized()),
    }
}

fn parse_bool_env(name: &str) -> Option<bool> {
    let value = std::env::var(name).ok()?;
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let token = raw.strip_prefix("Bearer ")?;
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

fn internal_error(message: String) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message)
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
    std::path::Path::new(&exe_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine cwd".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn get_cwd_for_pid(_pid: i32) -> Result<String, String> {
    Err("CWD detection not supported on this platform".to_string())
}
