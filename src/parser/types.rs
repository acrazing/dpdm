use std::collections::HashMap;
use regex::Regex;
use crate::parser::consts::DependencyKind;
use indicatif::ProgressBar;

pub struct ParseOptions {
  pub context: String,
  pub extensions: Vec<String>,
  pub js: Vec<String>,
  pub include: Regex,
  pub exclude: Regex,
  pub tsconfig: Option<String>,
  pub on_progress: fn(&str, &str, &mut usize, &mut usize, &mut String, &ProgressBar), // 更新函数指针类型
  pub transform: bool,
  pub skip_dynamic_imports: bool,
}

#[derive(Debug)]
pub struct Dependency {
    pub issuer: String,
    pub request: String,
    pub kind: DependencyKind,
    pub id: Option<String>,
}
pub type DependencyTree = HashMap<String, Vec<Dependency>>;

pub struct OutputResult {
    pub entries: Vec<String>,
    pub tree: DependencyTree,
    pub circulars: Vec<Vec<String>>,
}
