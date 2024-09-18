use std::path::Path;

use std::fs;

pub async fn append_suffix(
    request: &str,
    extensions: &[String],
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    for ext in extensions {
        let path_with_ext = format!("{}{}", request, ext);
        if fs::metadata(&path_with_ext).is_ok() {
            return Ok(Some(path_with_ext));
        }
    }
    if fs::metadata(request).is_ok() {
        // 使用 Box::pin 来解决递归调用的问题
        return append_suffix_boxed(&format!("{}/index", request), extensions).await;
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

pub type Resolver =
    fn(String, String, Vec<String>) -> Result<Option<String>, Box<dyn std::error::Error>>;

pub async fn simple_resolver(
    context: String,
    request: String,
    extensions: Vec<String>,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    if Path::new(&request).is_absolute() {
        return append_suffix(&request, &extensions).await;
    }
    if request.starts_with('.') {
        return append_suffix(
            &Path::new(&context)
                .join(&request)
                .to_string_lossy()
                .into_owned(),
            &extensions,
        )
        .await;
    }

    // 处理 package 的情况
    let node_path = vec![context.clone()];
    let pkg_path = Path::new(&context).join("package.json");
    if pkg_path.exists() {
        let pkg_json: serde_json::Value = serde_json::from_str(&fs::read_to_string(&pkg_path)?)?;
        if let Some(main) = pkg_json.get("main").or_else(|| pkg_json.get("module")) {
            let id = Path::new(&pkg_path)
                .parent()
                .unwrap()
                .join(main.as_str().unwrap())
                .to_string_lossy()
                .into_owned();
            return append_suffix(&id, &extensions).await;
        }
    }

    // 尝试直接解析请求
    for path in &node_path {
        let full_path = Path::new(path).join(&request);
        if full_path.exists() {
            return Ok(Some(full_path.to_string_lossy().into_owned()));
        }
    }

    Ok(None)
}
