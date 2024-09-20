use std::{collections::HashMap, path::Path};

use crate::parser::types::{Dependency, DependencyTree};

pub fn shorten_tree(context: &String, tree: &DependencyTree) -> DependencyTree {
    let mut output: DependencyTree = HashMap::new();
    for (key, dependencies) in tree.iter() {
        let short_key = Path::new(key)
            .strip_prefix(&context)
            .unwrap_or_else(|_| Path::new(key))
            .to_str()
            .unwrap()
            .to_string();
        output.insert(
            short_key.clone(),
            dependencies.as_ref().map(|deps| {
                deps.iter()
                    .map(|item| Dependency {
                        issuer: short_key.clone(),
                        request: item.request.clone(),
                        kind: item.kind.clone(),
                        id: item.id.as_ref().map(|id| {
                            Path::new(id)
                                .strip_prefix(&context)
                                .unwrap_or_else(|_| Path::new(id))
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
