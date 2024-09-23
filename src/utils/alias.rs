use lazy_static::lazy_static;
use regex::Regex;
use std::collections::HashMap;
use std::sync::Mutex;

use super::path::join_paths;

lazy_static! {
    static ref CACHE: Mutex<HashMap<String, Option<String>>> = Mutex::new(HashMap::new());
}

pub fn match_alias_pattern(source: &str, root: &str, alias: &str, path: &str) -> Option<String> {
    let cache_key = format!("{}|{}|{}|{}", source, root, alias, path);

    if let Some(cached_result) = CACHE.lock().unwrap().get(&cache_key) {
        return cached_result.clone();
    }

    // Step 1: 创建匹配别名的正则表达式，将别名中的 `*` 替换为正则表达式的 `.*`
    let alias_regex_str = regex::escape(alias).replace(r"\*", r"(.*)");
    let alias_regex = Regex::new(&format!("^{}$", alias_regex_str)).ok()?;

    // Step 2: 检查 source 是否匹配别名模式
    if let Some(captures) = alias_regex.captures(source) {
        // 如果匹配，获取通配符匹配到的部分
        let wildcard_part = captures.get(1).map_or("", |m| m.as_str());

        // Step 3: 将路径中的 `*` 替换为通配符部分
        let transformed_path = path.replace('*', wildcard_part);

        // Step 4: 使用 `join_paths` 将 root 和 transformed_path 组合成完整路径
        let full_path = join_paths(&[root, &transformed_path]);

        return Some(full_path.to_string_lossy().to_string());
    }

    // // 如果没有匹配，返回 source 原值
    // // Some(source.to_string())
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_match_alias_pattern_with_wildcard() {
        assert_eq!(
            match_alias_pattern("@/components/Button", "/User/App", "@/*", "./src/*"),
            Some("/User/App/src/components/Button".to_string())
        );
    }

    #[test]
    fn test_match_alias_pattern_source_without_wildcard() {
        assert_eq!(
            match_alias_pattern("./components/Button", "/User/App", "@/*", "./src/*"),
            None
        );
        assert_eq!(
            match_alias_pattern("react", "/User/App", "@/*", "./src/*"),
            None
        );
    }

    #[test]
    fn test_match_alias_pattern_with_long_alias() {
        assert_eq!(
            match_alias_pattern(
                "@/components/Button",
                "/User/App",
                "@/components/*",
                "./src/*"
            ),
            Some("/User/App/src/Button".to_string())
        );
    }

    #[test]
    fn test_match_alias_pattern_with_like_alias_in_path() {
        assert_eq!(
            match_alias_pattern("@/components/Button_@/A.js", "/User/App", "@/*", "./src/*"),
            Some("/User/App/src/components/Button_@/A.js".to_string())
        );
    }
}
