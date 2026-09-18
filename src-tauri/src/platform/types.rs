use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
pub struct Window {
    pub token: String,
    pub title: String,
    pub process: String,
    pub path: String,
}
#[derive(Clone, Deserialize)]
pub struct Focus {
    pub names: Vec<String>,
    pub ids: Vec<String>,
    pub terminal: bool,
    pub wait_ms: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct InstalledApp {
    pub name: String,
    #[serde(rename = "AppID")]
    pub app_id: String,
}
