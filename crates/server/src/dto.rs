//! HTTP 応答の型。ファイルシステム上のパスをクライアントへ出さないための境界。

use gim_core::db::image_query::ImageRow;
use gim_core::models::Directory;
use serde::Serialize;

/// 一覧表示に必要な列だけ。画像の取得は id 経由（/api/thumb/{id}・/api/image/{id}）なので
/// パスは要らない。認証なしで LAN に公開する以上、出さないものは持たせない。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImageDto {
    pub id: i64,
    pub filename: String,
    pub width: i64,
    pub height: i64,
    pub rating: Option<i64>,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
    pub source_tool: String,
    pub model: Option<String>,
}

impl From<ImageRow> for ImageDto {
    fn from(r: ImageRow) -> Self {
        Self {
            id: r.id,
            filename: r.filename,
            width: r.width,
            height: r.height,
            rating: r.rating,
            created_at: r.created_at,
            modified_at: r.modified_at,
            source_tool: r.source_tool,
            model: r.model,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DirectoryDto {
    pub id: i64,
    pub label: String,
    pub is_online: bool,
    pub visible: bool,
    pub image_count: i64,
}

impl From<Directory> for DirectoryDto {
    fn from(d: Directory) -> Self {
        Self {
            id: d.id,
            label: d.label,
            is_online: d.is_online,
            visible: d.visible,
            image_count: d.image_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_dto_carries_display_columns() {
        let row = ImageRow {
            id: 7,
            path: "/Users/someone/pics/a.png".to_string(),
            filename: "a.png".to_string(),
            thumb_path: Some("/Users/someone/thumbs/x.webp".to_string()),
            width: 1024,
            height: 1536,
            pixels: 1024 * 1536,
            rating: Some(4),
            created_at: Some(1000),
            modified_at: Some(2000),
            source_tool: "a1111".to_string(),
            model: Some("sd_xl".to_string()),
        };
        let dto = ImageDto::from(row);
        assert_eq!(dto.id, 7);
        assert_eq!(dto.filename, "a.png");
        assert_eq!(dto.width, 1024);
        assert_eq!(dto.height, 1536);
        assert_eq!(dto.rating, Some(4));
        assert_eq!(dto.model.as_deref(), Some("sd_xl"));

        // シリアライズ結果にパスが混ざらないこと。
        let json = serde_json::to_string(&dto).unwrap();
        assert!(!json.contains("/Users/"), "パスが漏れている: {json}");
        assert!(!json.contains("thumb_path"));
    }
}
