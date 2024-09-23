use colored::Colorize;

use crate::parser::types::DependencyTree;
use std::collections::HashMap;

pub fn pretty_circular(circulars: &[Vec<String>], prefix: &str) -> String {
    let digits = (circulars.len() as f64).log10().ceil() as usize;
    circulars
        .iter()
        .enumerate()
        .map(|(index, line)| {
            format!(
                "{}{}{}{}",
                prefix,
                format!("{:0>width$}", index + 1, width = digits).color("gray"),
                ") ".color("gray"),
                line.iter()
                    .map(|item| item.red().to_string())
                    .collect::<Vec<_>>()
                    .join(&" -> ".color("gray").to_string())
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn pretty_tree(tree: &DependencyTree, entries: &[String], prefix: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut id = 0;
    let mut id_map: HashMap<String, usize> = HashMap::new();
    let digits = (tree.len() as f64).log10().ceil() as usize;

    fn visit(
        item: &str,
        prefix: &str,
        has_more: bool,
        lines: &mut Vec<String>,
        id_map: &mut HashMap<String, usize>,
        id: &mut usize,
        tree: &DependencyTree,
        digits: usize,
    ) {
        let is_new = id_map.get(item).is_none();
        let iid = *id_map.entry(item.to_string()).or_insert_with(|| {
            let current_id = *id;
            *id += 1;
            current_id
        });
        let line = format!(
            "{}- {}{}",
            prefix,
            format!("{:0>width$}", iid, width = digits),
            ") ",
        )
        .truecolor(144, 144, 144);
        let deps = tree.get(item);

        if all_builtins().contains(&item) {
            lines.push(format!("{}{}", line, item.color("blue")));
            return;
        } else if !is_new {
            lines.push(format!("{}{}", line, item.truecolor(144, 144, 144)));
            return;
        } else {
            match deps {
                Some(deps) => {
                    if deps.is_none() {
                        lines.push(format!("{}{}", line, item.color("yellow")));
                        return;
                    }
                }
                None => {
                    lines.push(format!("{}{}", line, item.color("yellow")));
                    return;
                }
            }
        }

        lines.push(format!("{}{}", line, item));
        let new_prefix = if has_more {
            format!("{}·   ", prefix)
        } else {
            format!("{}    ", prefix)
        };
        if let Some(Some(deps)) = deps {
            for (i, dep) in deps.iter().enumerate() {
                visit(
                    dep.id.as_deref().unwrap_or(&dep.request),
                    &new_prefix,
                    i < deps.len() - 1,
                    lines,
                    id_map,
                    id,
                    tree,
                    digits,
                );
            }
        }
    }

    for (i, entry) in entries.iter().enumerate() {
        visit(
            entry,
            prefix,
            i < entries.len() - 1,
            &mut lines,
            &mut id_map,
            &mut id,
            tree,
            digits,
        );
    }

    lines.join("\n")
}

pub fn all_builtins() -> Vec<&'static str> {
    vec![
        "assert",
        "buffer",
        "child_process",
        "cluster",
        "console",
        "constants",
        "crypto",
        "dgram",
        "dns",
        "domain",
        "events",
        "fs",
        "http",
        "http2",
        "https",
        "inspector",
        "module",
        "net",
        "os",
        "path",
        "perf_hooks",
        "process",
        "punycode",
        "querystring",
        "readline",
        "repl",
        "stream",
        "string_decoder",
        "timers",
        "tls",
        "trace_events",
        "tty",
        "url",
        "util",
        "v8",
        "vm",
        "worker_threads",
        "zlib",
    ]
}

pub fn pretty_warning(warnings: &[String], prefix: &str) -> String {
    let digits = (warnings.len() as f64).log10().ceil() as usize;
    warnings
        .iter()
        .enumerate()
        .map(|(index, line)| {
            format!(
                "{}{}{}",
                prefix,
                format!("{:0>width$}) ", index + 1, width = digits).color("gray").truecolor(144, 144, 144),
                line.yellow()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}
