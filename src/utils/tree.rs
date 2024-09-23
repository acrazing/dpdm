use std::collections::HashSet;

use crate::parser::{consts::DependencyKind, types::DependencyTree};

use super::pretty::all_builtins;

pub fn is_empty<T>(v: &T) -> bool
where
    T: ?Sized + serde::Serialize,
{
    let json = serde_json::to_value(v).unwrap_or_default();
    match json {
        serde_json::Value::Object(map) => map.is_empty(),
        serde_json::Value::Array(arr) => arr.is_empty(),
        _ => false,
    }
}

pub fn parse_circular(tree: &mut DependencyTree, skip_dynamic_imports: bool) -> Vec<Vec<String>> {
    let mut circulars: Vec<Vec<String>> = Vec::new();

    fn visit(
        id: String,
        mut used: Vec<String>,
        tree: &mut DependencyTree,
        skip_dynamic_imports: bool,
        circulars: &mut Vec<Vec<String>>,
    ) {
        if let Some(index) = used.iter().position(|x| x == &id) {
            circulars.push(used[index..].to_vec());
        } else if let Some(deps) = tree.remove(&id) {
            used.push(id.clone());

            if let Some(deps) = deps.as_ref() {
                for dep in deps {
                    if !skip_dynamic_imports || dep.kind != DependencyKind::DynamicImport {
                        if let Some(id) = dep.id.as_deref() {
                            visit(id.to_string(), used.clone(), tree, skip_dynamic_imports, circulars);
                        }
                    }
                }
            }
        }
    }

    for id in tree.clone().keys() {
        visit(
            id.clone(),
            Vec::new(),
            tree,
            skip_dynamic_imports,
            &mut circulars,
        );
    }

    circulars
}

fn dependents(tree: &DependencyTree, key: &str) -> Vec<String> {
    let mut output: Vec<String> = Vec::new();
    for (k, deps) in tree {
        if let Some(deps) = deps.as_ref() {
            for dep in deps {
                if let Some(id) = &dep.id {
                    if id == key {
                        output.push(k.clone());
                    }
                }
            }
        }
    }
    output.sort();
    output
}

pub fn parse_warnings(tree: &DependencyTree) -> Vec<String> {
    let mut warnings: Vec<String> = Vec::new();
    let mut builtin: HashSet<String> = HashSet::new();
    let all_builtins = all_builtins();

    for (key, deps) in tree {
        if !builtin.contains(key) && all_builtins.contains(&key.as_str()) {
            builtin.insert(format!("\"{}\"", key.clone()));
        }
        if deps.is_none() {
            warnings.push(format!(
                "skip \"{}\", issuers: {:?}",
                key,
                dependents(tree, key).join(", ")
            ));
        } else {
            for dep in deps.as_ref().clone().unwrap() {
                if dep.id.is_none() {
                    warnings.push(format!("miss \"{}\" in \"{}\"", dep.request, dep.issuer));
                }
            }
        }
    }

    if !builtin.is_empty() {
        warnings.push(format!(
            "node {}",
            builtin.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }

    warnings.sort();
    warnings
}
