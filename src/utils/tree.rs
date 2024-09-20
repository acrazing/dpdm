use crate::parser::{consts::DependencyKind, types::DependencyTree};

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

pub fn parse_circular(tree: & mut DependencyTree, skip_dynamic_imports: bool) -> Vec<Vec<String>> {
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

            if let Some(_dep) = deps {
                for dep in _dep {
                    if !skip_dynamic_imports || dep.kind != DependencyKind::DynamicImport {
                        if let Some(id) = dep.id {
                            visit(id, used.clone(), tree, skip_dynamic_imports, circulars);
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
