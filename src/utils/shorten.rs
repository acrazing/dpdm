use std::{collections::HashMap, path::Path};

use crate::parser::types::{Dependency, DependencyTree};

pub fn shorten_tree(context: String, tree: DependencyTree) -> DependencyTree {
    let mut output: DependencyTree = HashMap::new();
    for (key, dependencies) in tree.iter() {
        let short_key = Path::new(key)
            .strip_prefix(&context)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        output.insert(
            short_key.clone(),
            dependencies
                .as_ref() // 修改：使用 as_ref() 以处理 Option<Vec<Dependency>>
                .map(|deps| {
                    deps.iter()
                        .map(|item| Dependency {
                            issuer: short_key.clone(),
                            request: item.request.clone(), // 确保 request 字段被正确复制
                            kind: item.kind.clone(),       // 确保 kind 字段被正确复制
                            id: item.id.as_ref().map(|id| {
                                Path::new(id)
                                    .strip_prefix(&context)
                                    .unwrap()
                                    .to_str()
                                    .unwrap()
                                    .to_string()
                            }),
                        })
                        .collect::<Vec<Dependency>>()
                }),
        );
    }
    output
}
