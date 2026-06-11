pub mod compile;
pub mod parse;

/// 構造化条件の演算子。日時も epoch 秒の数値として扱う。
#[derive(Debug, Clone, PartialEq)]
pub enum CondOp {
    Like(String),
    Ge(i64),
    Le(i64),
    Gt(i64),
    Lt(i64),
    Eq(i64),
    Range(i64, i64), // 両端含む
    /// 集合メンバーシップ。`values` は許可する数値、`include_null` は NULL を含めるか。
    /// レーティングの「なし(none)＋1,3」のような任意の部分集合に使う。
    InSet { values: Vec<i64>, include_null: bool },
}

/// 1つの構造化条件（FTS対象外の列に対する条件）。
#[derive(Debug, Clone, PartialEq)]
pub struct Cond {
    pub column: &'static str, // 検証済みの列名（SQLに直接埋めてよい）
    pub op: CondOp,
    pub negate: bool,
}

/// パース結果。テキストはFTS式、構造化条件は Cond。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedQuery {
    pub fts_include: Option<String>, // 正のFTS5 MATCH式
    pub fts_exclude: Option<String>, // 除外のFTS5 MATCH式（id NOT IN に使う）
    pub conds: Vec<Cond>,
}

/// ソートキー（許可リスト）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SortKey {
    Filename,
    Created,
    Modified,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SortDir {
    Asc,
    Desc,
}

impl SortKey {
    pub fn parse(s: &str) -> SortKey {
        match s {
            "created" => SortKey::Created,
            "modified" => SortKey::Modified,
            _ => SortKey::Filename,
        }
    }
    /// ORDER BY に埋める列式（許可リストのみなのでSQL注入の余地はない）。
    pub fn column(self) -> &'static str {
        match self {
            SortKey::Filename => "filename COLLATE NOCASE",
            SortKey::Created => "created_at",
            SortKey::Modified => "modified_at",
        }
    }
}

impl SortDir {
    pub fn parse(s: &str) -> SortDir {
        if s.eq_ignore_ascii_case("asc") {
            SortDir::Asc
        } else {
            SortDir::Desc
        }
    }
    pub fn sql(self) -> &'static str {
        match self {
            SortDir::Asc => "ASC",
            SortDir::Desc => "DESC",
        }
    }
}
