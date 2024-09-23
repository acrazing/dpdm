use std::path::{Path, PathBuf};

use std::fs;

use crate::parser::types::Alias;
use crate::utils::alias::match_alias_pattern;
use crate::utils::path::join_paths;
use futures::future::join_all;
use node_resolve::resolve_from;

pub async fn append_suffix(
    request: &str,
    extensions: &[String],
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    // 并行处理扩展名检查
    let futures = extensions.iter().map(|ext| {
        let path_with_ext = format!("{}{}", request, ext);
        async move {
            match fs::metadata(&path_with_ext) {
                Ok(metadata) => {
                    if metadata.is_file() {
                        return Some(path_with_ext);
                    }
                }
                Err(_) => {}
            }
            None
        }
    });
    let results = join_all(futures).await;
    for result in results {
        if let Some(path) = result {
            return Ok(Some(path));
        }
    }

    // 如果 request 是一个目录，则尝试添加 index 后缀，递归调用
    match fs::metadata(request) {
        Ok(metadata) => {
            if metadata.is_dir() {
                return append_suffix_boxed(&format!("{}/index", request), extensions).await;
            }
        }
        Err(_) => {}
    }

    Ok(None)
}

async fn append_suffix_boxed(
    request: &str,
    extensions: &[String],
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    // 使用 Box::pin 来处理递归调用
    Box::pin(append_suffix(request, extensions)).await
}

pub async fn simple_resolver(
    context: &str,
    request: &str,
    extensions: &Vec<String>,
    alias: Option<&Alias>,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    if let Some(alias) = alias {
        let root_str = alias.root.to_string_lossy().to_string();
        for (key, paths) in &alias.paths {
            for path in paths {
                if let Some(new_request) = match_alias_pattern(request, &root_str, key, path) {
                    let result = Box::pin(simple_resolver(
                        context,
                        &new_request,
                        extensions,
                        Some(alias),
                    ))
                    .await?;
                    if result.is_some() {
                        return Ok(result);
                    }
                }
            }
        }
    }

    if Path::new(&request).is_absolute() {
        let result = append_suffix(&request, &extensions).await;
        return result;
    }
    if request.starts_with('.') {
        let new_path = join_paths(&[&context, &request]);
        let result = append_suffix(&new_path.to_string_lossy().into_owned(), &extensions).await;
        return result;
    }

    let base_dir = PathBuf::from(&context);
    let pkg_path = Path::new(&request)
        .join("package.json")
        .to_string_lossy()
        .into_owned();
    // 处理 package 的情况
    match resolve_from(&pkg_path, base_dir.clone()) {
        Ok(resolved_path) => {
            let pkg_json: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&resolved_path)?)?;
            if let Some(main) = pkg_json.get("main").or_else(|| pkg_json.get("module")) {
                let main_path: PathBuf = Path::new(main.as_str().unwrap()).to_path_buf();
                let parent_path: PathBuf = resolved_path.parent().unwrap().to_path_buf();
                let id: PathBuf = join_paths(&[&parent_path, &main_path]);
                return append_suffix(&id.to_string_lossy().into_owned(), &extensions).await;
            }
        }
        Err(_) => {}
    }

    match resolve_from(&request, base_dir) {
        Ok(resolved_path) => {
            let result = resolved_path.to_string_lossy().into_owned();
            return Ok(Some(result));
        }
        Err(_) => {}
    }

    Ok(None)
}
