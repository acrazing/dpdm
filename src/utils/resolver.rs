use std::path::{Path, PathBuf};

use std::fs;

use crate::utils::path::join_paths;
use node_resolve::{resolve, resolve_from};

// TODO: node_modules 检测 & 动态导入
pub async fn append_suffix(
    request: &str,
    extensions: &[String],
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    for ext in extensions {
        let path_with_ext: String = format!("{}{}", request, ext);
        match fs::metadata(&path_with_ext) {
            Ok(metadata) => {
                if metadata.is_file() {
                    return Ok(Some(path_with_ext));
                }
            }
            Err(_) => {}
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
    context: String,
    request: String,
    extensions: Vec<String>,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
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
    // 处理 package 的情况
    match resolve_from(&context, base_dir) {
        Ok(resolved_path) => {
            println!("pkgPath: {:?}", resolved_path);
            let pkg_json: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&resolved_path)?)?;
            if let Some(main) = pkg_json.get("main").or_else(|| pkg_json.get("module")) {
                let id = Path::new(&resolved_path)
                    .parent()
                    .unwrap()
                    .join(main.as_str().unwrap())
                    .to_string_lossy()
                    .into_owned();
                return append_suffix(&id, &extensions).await;
            }
        }
        Err(_) => {}
    }

    // 尝试直接解析请求
    for path in &[context] {
      let full_path = Path::new(path).join(&request);
      if full_path.exists() {
          return Ok(Some(full_path.to_string_lossy().into_owned()));
      }
  }


    Ok(None)
}

// pub async fn ts_resolver(
//     context: String,
//     request: String,
//     extensions: Vec<String>,
// ) -> Result<Option<String>, Box<dyn std::error::Error>> {

// }
