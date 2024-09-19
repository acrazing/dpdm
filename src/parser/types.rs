use crate::parser::consts::DependencyKind;
use indicatif::ProgressBar;
use regex::Regex;
use serde::{self, Serializer};
use std::collections::HashMap;

fn serialize_regex<S>(regex: &Regex, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&regex.to_string())
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct ParseOptions {
    pub context: String,
    pub extensions: Vec<String>,
    pub js: Vec<String>,
    #[serde(serialize_with = "serialize_regex")]
    pub include: Regex,
    #[serde(serialize_with = "serialize_regex")]
    pub exclude: Regex,
    pub tsconfig: Option<String>,
    #[serde(skip)]
    pub on_progress: fn(&str, &str, &mut usize, &mut usize, &mut String, &ProgressBar), // 更新函数指针类型
    pub transform: bool,
    pub skip_dynamic_imports: bool,
}

#[derive(Debug, serde::Serialize, Clone)]
pub struct Dependency {
    pub issuer: String,
    pub request: String,
    pub kind: DependencyKind,
    pub id: Option<String>,
}
pub type DependencyTree = HashMap<String, Option<Vec<Dependency>>>;

pub struct OutputResult {
    pub entries: Vec<String>,
    pub tree: DependencyTree,
    pub circulars: Vec<Vec<String>>,
}

pub struct Alias {
    pub base_url: String,
    pub paths: HashMap<String, Vec<String>>,
}
