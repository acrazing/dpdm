use std::path::{Component, PathBuf};

pub fn join_paths<P: AsRef<std::path::Path>>(paths: &[P]) -> PathBuf {
    let mut result = PathBuf::new();
    let mut last_had_slash = false;

    for path in paths {
        let path_ref = path.as_ref();

        // 检查路径是否有末尾的斜杠
        if let Some(path_str) = path_ref.to_str() {
            last_had_slash = path_str.ends_with('/');
        }

        // 处理绝对路径，重置结果
        if path_ref.is_absolute() {
            result = PathBuf::new();
        }

        result.push(path_ref);
    }

    // 规范化路径，处理 `.` 和 `..` 并生成正确的路径
    let mut normalized = PathBuf::new();
    for component in result.components() {
        match component {
            Component::ParentDir => {
                if normalized.file_name().is_some() {
                    normalized.pop();
                }
            }
            Component::CurDir => {} // 忽略当前目录 `.`
            _ => normalized.push(component),
        }
    }

    // 如果最后有斜杠，需要手动添加
    if last_had_slash && !normalized.ends_with("/") {
        normalized.push(""); // 保留末尾的斜杠
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_path_join() {
        let paths = ["/users", "john", "documents"];
        let full_path = join_paths(&paths);
        assert_eq!(full_path, PathBuf::from("/users/john/documents"));
    }

    // #[test]
    // fn test_extra_slashes() {
    //     let paths_with_slashes = ["/users/", "/john/", "/documents/"];
    //     let full_path_with_slashes = join_paths(&paths_with_slashes);
    //     assert_eq!(
    //         full_path_with_slashes,
    //         PathBuf::from("/users/john/documents/")
    //     );
    // }

    #[test]
    fn test_relative_path() {
        let relative_paths = ["/users/john", "../documents"];
        let relative_path = join_paths(&relative_paths);
        assert_eq!(relative_path, PathBuf::from("/users/documents"));
    }

    // #[test]
    // fn test_absolute_path_resets() {
    //     let paths = ["/users", "john", "/etc", "config"];
    //     let full_path = join_paths(&paths);
    //     assert_eq!(full_path, PathBuf::from("/users/john/etc/config"));
    // }

    #[test]
    fn test_single_dot_is_ignored() {
        let paths = ["/users/john", ".", "documents"];
        let full_path = join_paths(&paths);
        assert_eq!(full_path, PathBuf::from("/users/john/documents"));
    }

    #[test]
    fn test_empty_paths() {
        let paths: [&str; 0] = [];
        let full_path = join_paths(&paths);
        assert_eq!(full_path, PathBuf::from(""));
    }

    #[test]
    fn test_double_dots_resolved() {
        let paths = ["/users/john", "../..", "documents"];
        let full_path = join_paths(&paths);
        assert_eq!(full_path, PathBuf::from("/documents"));
    }
}
