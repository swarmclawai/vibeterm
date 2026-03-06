use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Running,
    Idle,
    Errored,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMetadata {
    pub label: String,
    pub status: TaskStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub task: TaskMetadata,
    pub pid: Option<u32>,
    pub launcher_id: String,
    pub launcher_label: String,
    pub resume_mode: String,
    pub provider_session_id: String,
}
