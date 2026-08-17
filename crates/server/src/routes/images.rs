use crate::dirscope::parse_dirs;
use crate::error::ApiError;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::Json;
use gim_core::db::image_query::{self, DirScope};
use gim_core::query::{SortDir, SortKey};
use serde::{Deserialize, Serialize};

const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 1000;

#[derive(Deserialize, Default)]
pub struct ListParams {
    #[serde(default)]
    pub q: String,
    pub sort: Option<String>,
    pub dir: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub dirs: Option<String>,
}

impl ListParams {
    fn sort_key(&self) -> SortKey {
        SortKey::parse(self.sort.as_deref().unwrap_or("filename"))
    }
    fn sort_dir(&self) -> SortDir {
        SortDir::parse(self.dir.as_deref().unwrap_or("asc"))
    }
    fn limit(&self) -> Result<i64, ApiError> {
        let v = self.limit.unwrap_or(DEFAULT_LIMIT);
        if !(1..=MAX_LIMIT).contains(&v) {
            return Err(ApiError::BadRequest(format!(
                "limit は 1〜{MAX_LIMIT} で指定してください: {v}"
            )));
        }
        Ok(v)
    }
    fn offset(&self) -> Result<i64, ApiError> {
        let v = self.offset.unwrap_or(0);
        if v < 0 {
            return Err(ApiError::BadRequest(format!("offset は 0 以上です: {v}")));
        }
        Ok(v)
    }
}

fn scope(params: &ListParams) -> Result<DirScope, ApiError> {
    parse_dirs(params.dirs.as_deref()).map_err(ApiError::BadRequest)
}

pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<crate::dto::ImageDto>>, ApiError> {
    let conn = state.conn()?;
    let rows = image_query::query_images(
        &conn,
        &params.q,
        &scope(&params)?,
        params.sort_key(),
        params.sort_dir(),
        params.limit()?,
        params.offset()?,
    )?;
    Ok(Json(rows.into_iter().map(Into::into).collect()))
}

#[derive(Serialize)]
pub struct CountBody {
    pub total: i64,
}

pub async fn count(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<CountBody>, ApiError> {
    let conn = state.conn()?;
    let total = image_query::count_query(&conn, &params.q, &scope(&params)?)?;
    Ok(Json(CountBody { total }))
}

pub async fn ids(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<i64>>, ApiError> {
    let conn = state.conn()?;
    let ids = image_query::list_ids(
        &conn,
        &params.q,
        &scope(&params)?,
        params.sort_key(),
        params.sort_dir(),
    )?;
    Ok(Json(ids))
}

#[cfg(test)]
mod tests {
    use crate::test_support::{get_json, get_raw, test_state};

    #[tokio::test]
    async fn list_returns_all_images_by_default() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images").await;
        assert_eq!(body.as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn list_applies_query_and_sort() {
        let (state, _tmp) = test_state();
        let body = get_json(state.clone(), "/api/images?q=forest").await;
        assert_eq!(body.as_array().unwrap().len(), 2);

        let desc = get_json(state, "/api/images?sort=filename&dir=desc").await;
        assert_eq!(desc[0]["filename"], "c.png");
    }

    #[tokio::test]
    async fn list_paginates() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images?limit=2&offset=2").await;
        let arr = body.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["filename"], "c.png");
    }

    #[tokio::test]
    async fn count_matches_list() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images/count?q=forest").await;
        assert_eq!(body["total"], 2);
    }

    #[tokio::test]
    async fn ids_returns_ordered_ids() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images/ids?sort=filename&dir=asc").await;
        assert_eq!(body.as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn empty_dirs_returns_nothing() {
        let (state, _tmp) = test_state();
        let body = get_json(state.clone(), "/api/images?dirs=").await;
        assert!(body.as_array().unwrap().is_empty());
        let count = get_json(state, "/api/images/count?dirs=").await;
        assert_eq!(count["total"], 0);
    }

    #[tokio::test]
    async fn explicit_dirs_selects_that_directory() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images?dirs=1").await;
        assert_eq!(body.as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn invalid_params_return_400() {
        let (state, _tmp) = test_state();
        for uri in [
            "/api/images?limit=0",
            "/api/images?limit=1001",
            "/api/images?offset=-1",
            "/api/images?dirs=x",
        ] {
            let res = get_raw(state.clone(), uri).await;
            assert_eq!(res.status(), 400, "{uri} は 400 を返すべき");
        }
    }

    #[tokio::test]
    async fn list_does_not_expose_filesystem_paths() {
        let (state, _tmp) = test_state();
        let body = get_json(state, "/api/images").await;
        let first = &body.as_array().unwrap()[0];

        assert!(first.get("path").is_none(), "絶対パスを返してはいけない");
        assert!(
            first.get("thumb_path").is_none(),
            "サムネイルの絶対パスも返してはいけない"
        );

        // フロントが必要とする列は残っていること。
        for key in [
            "id",
            "filename",
            "width",
            "height",
            "rating",
            "created_at",
            "source_tool",
        ] {
            assert!(first.get(key).is_some(), "{key} が欠けている");
        }
    }
}
