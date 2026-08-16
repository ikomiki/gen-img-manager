use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Directory {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub is_online: bool,
    pub last_scanned_at: Option<i64>,
    pub recursive: bool,
    pub visible: bool,
    pub image_count: i64,
}
