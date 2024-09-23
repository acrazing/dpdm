use super::parse_tree_recursive::parse_tree_recursive;
use super::types::{Alias, ParseOptions};
use crate::parser::types::DependencyTree;
use crate::utils::json::strip_jsonc_comments;
use crate::utils::options::normalize_options;
use crate::utils::path::join_paths;
use crate::utils::shorten::shorten_tree;
use glob::glob;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use swc_common::{sync::Lrc, SourceMap};

pub async fn parse_dependency_tree(
    entries: &Vec<String>,
    base_options: &ParseOptions,
) -> DependencyTree {
    let options: ParseOptions = normalize_options(Some((*base_options).clone()));

    let tsconfig_json = match options.tsconfig.as_ref() {
        Some(tsconfig) => {
            let tsconfig_data: serde_json::Value = match fs::read_to_string(PathBuf::from(tsconfig))
            {
                Ok(content) => {
                    let cleaned_content = strip_jsonc_comments(&content, true);
                    match serde_json::from_str(&cleaned_content) {
                        Ok(json) => json,
                        Err(e) => {
                            eprintln!("Failed to parse tsconfig.json: {:?}", e);
                            return HashMap::new();
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to read tsconfig.json: {:?}", e);
                    return HashMap::new();
                }
            };
            tsconfig_data
        }
        None => {
            return HashMap::new();
        }
    };

    let current_directory = fs::canonicalize(PathBuf::from(".")).unwrap();
    let root = match tsconfig_json
        .get("compilerOptions")
        .and_then(|co| co.get("baseUrl"))
        .and_then(|bu| bu.as_str())
    {
        Some(base_url) => {
            let base_url: PathBuf = PathBuf::from(base_url);
            join_paths(&[&current_directory, &base_url])
        }
        None => current_directory.clone(),
    };

    let paths = match tsconfig_json
        .get("compilerOptions")
        .and_then(|co| co.get("paths"))
    {
        Some(paths) => paths,
        None => &serde_json::Value::Null,
    };

    let alias = if paths.is_null() {
        None
    } else {
        Some(Alias {
            root,
            paths: paths
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| {
                    let values = v
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|val| val.as_str().unwrap().to_string())
                        .collect();
                    (k.clone(), values)
                })
                .collect(),
        })
    };

    let cm = Lrc::new(SourceMap::default());
    let output: Arc<Mutex<DependencyTree>> = Arc::new(Mutex::new(HashMap::new()));

    // 获取文件列表
    let mut tasks = vec![];
    for entry in entries {
        for entry_path in glob(&entry).expect("Failed to read glob pattern") {
            match entry_path {
                Ok(filename) => {
                    let path: PathBuf = current_directory.join(filename);
                    let output_clone = Arc::clone(&output);
                    let alias_arc = alias.as_ref().map(|a| Arc::new(a.clone()));
                    let task = parse_tree_recursive(
                        current_directory.clone(),
                        path,
                        output_clone,
                        Arc::new(cm.clone()),
                        Arc::new(options.clone()),
                        alias_arc,
                    );
                    tasks.push(task);
                }
                Err(e) => eprintln!("{:?}", e),
            }
        }
    }

    futures::future::join_all(tasks).await;

    let output_lock = output.lock().unwrap();
    shorten_tree(
        &current_directory.to_string_lossy().to_string(),
        &output_lock,
    )
}
