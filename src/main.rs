mod parser;
mod utils;

use clap::Parser;
use colored::Colorize;
use glob::glob;
use parser::parser::parse_dependency_tree;
use regex::Regex;
use serde_json::json;
use spinoff::{spinners, Color, Spinner};
use std::collections::HashSet;
use std::fs::File;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use utils::path::join_paths;
use utils::pretty::pretty_tree;
use utils::resolver::simple_resolver;

use parser::types::{IsModule, ParseOptions, Progress};

#[derive(Parser, Debug)]
#[clap(
    version = "1.0",
    name = "dpdm",
    about = "Analyze the files' dependencies."
)]
struct Args {
    /// The file paths or globs
    #[arg(required = true)]
    files: Vec<String>,

    /// The context directory to shorten path, default is current directory
    #[arg(long)]
    context: Option<String>,

    /// Comma separated extensions to resolve
    #[arg(short, long, default_value = "ts,tsx,mjs,js,jsx,json")]
    extensions: String,

    /// Comma separated extensions indicate the file is js like
    #[arg(long, default_value = "ts,tsx,mjs,js,jsx")]
    js: String,

    /// Included filenames regexp in string, default includes all files
    #[arg(long, default_value = ".*")]
    include: String,

    /// Excluded filenames regexp in string, set as empty string to include all files
    #[arg(long, default_value = "node_modules")]
    exclude: String,

    /// Output json to file
    #[arg(short, long)]
    output: Option<String>,

    /// Print tree to stdout
    #[arg(long, default_value = "false")]
    no_tree: bool,

    /// Print circular to stdout
    #[arg(long, default_value = "true")]
    circular: bool,

    /// Print warning to stdout
    #[arg(long, default_value = "false")]
    no_warning: bool,

    /// The tsconfig path, which is used for resolve path alias
    #[arg(long)]
    tsconfig: Option<String>,

    /// Transform typescript modules to javascript before analyze
    #[arg(short = 'T', long, default_value = "false")]
    transform: bool,

    /// Exit with specified code
    #[arg(long)]
    exit_code: Option<String>,

    /// Show progress bar
    #[arg(long, default_value = "true")]
    no_progress: bool,

    /// This file is a glob, used for finding unused files
    #[arg(long)]
    detect_unused_files_from: Option<String>,
    /// Skip parse import(...) statement
    #[arg(long)]
    skip_dynamic_imports: Option<String>,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    // 处理参数
    let files = args.files;

    if files.is_empty() {
        eprintln!("\nMissing entry file");
        std::process::exit(1);
    }

    let exit_cases: HashSet<&str> = ["circular"].iter().cloned().collect();
    let mut exit_codes: Vec<(String, i32)> = Vec::new();

    if let Some(exit_code_str) = args.exit_code {
        for c in exit_code_str.split(',') {
            let parts: Vec<&str> = c.split(':').collect();
            if parts.len() != 2 {
                eprintln!("Invalid exit code format");
                std::process::exit(1);
            }
            let label = parts[0];
            let code: i32 = parts[1].parse().unwrap_or_else(|_| {
                eprintln!("exit code should be a number");
                std::process::exit(1);
            });

            if !exit_cases.contains(label) {
                eprintln!("unsupported exit case \"{}\"", label);
                std::process::exit(1);
            }
            exit_codes.push((label.to_string(), code));
        }
    }

    let spinner = Arc::new(Mutex::new(Spinner::new(
        spinners::Dots,
        "Start analyzing dependencies...",
        Color::Green,
        // Streams::Stdout,
    )));

    let context: String = args.context.as_ref().map(|s| s.clone()).unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned()
    });

    let no_progress = args.no_progress;

    let progress = Progress {
        total: Arc::new(Mutex::new(0)),
        current: Arc::new(Mutex::new(String::new())),
        ended: Arc::new(Mutex::new(0)),
        spinner,
    };

    let mut extensions: Vec<String> = args
        .extensions
        .split(',')
        .map(|s| format!(".{}", s))
        .collect();
    extensions.insert(0, String::from(""));
    let options = ParseOptions {
        context,
        extensions,
        js: args
            .js
            .split(',')
            .map(String::from)
            .map(|s| format!(".{}", s))
            .collect(),
        include: Regex::new(&args.include).unwrap_or_else(|_| Regex::new(".*").unwrap()),
        exclude: Regex::new(&args.exclude).unwrap_or_else(|_| Regex::new("$").unwrap()),
        tsconfig: args.tsconfig.clone(),
        transform: args.transform,
        skip_dynamic_imports: args.skip_dynamic_imports.as_deref() == Some("tree"),
        is_module: IsModule::Unknown,
        progress: match no_progress {
            true => {
                progress.spinner.lock().unwrap().stop();
                None
            }
            false => Some(progress),
        },
    };

    let dependency_tree = parse_dependency_tree(&files, &options).await;

    if utils::tree::is_empty(&dependency_tree) {
        println!("\nNo entry files were matched.");
        std::process::exit(1);
    }

    let circulars: Vec<Vec<String>> =
        utils::tree::parse_circular(&mut dependency_tree.clone(), options.skip_dynamic_imports);

    let output = args.output.clone();
    if output.is_some() || !args.no_tree {
        let entries_deep = futures::future::join_all(files.iter().map(|g: &String| {
            let _g = g.clone();
            async move {
                glob(&_g)
                    .expect("Failed to read glob pattern")
                    .filter_map(Result::ok)
                    .collect::<Vec<_>>()
            }
        }))
        .await;
        let entries: Vec<_> =
            futures::future::join_all(entries_deep.into_iter().flatten().map(|name| {
                let path_context: PathBuf = PathBuf::from(options.context.clone());
                let _context: String = options.context.clone();
                let _extensions: Vec<String> = options.extensions.clone();

                let params_name: String = join_paths(&[&path_context, &name])
                    .to_string_lossy()
                    .into_owned();

                let _clone_name: String = name.to_string_lossy().into_owned();

                async move {
                    simple_resolver(&_context, &params_name, &_extensions, None)
                        .await
                        .map(|id| id.unwrap_or(_clone_name))
                        // let it be shorten path
                        .map(|id| utils::shorten::shorten_path(&id, &_context))
                        .unwrap_or_else(|e| format!("Error: {}", e))
                }
            }))
            .await
            .into_iter()
            .collect();

        if output.is_some() {
            let file = File::create(args.output.clone().unwrap()).expect("Failed to create file");
            let data = json!({
                "entries": entries,
                "tree": dependency_tree,
                "circulars": circulars
            });
            serde_json::to_writer_pretty(file, &data).expect("Failed to write JSON");
        }

        if !args.no_tree {
            println!("{}", "• Dependencies Tree".bold());
            println!("{}", pretty_tree(&dependency_tree, &entries, ""));
            println!("");
        }
        Some(entries)
    } else {
        None
    };

    let is_circular_empty = circulars.is_empty();
    println!(
        "{}",
        "• Circular Dependencies"
            .bold()
            .color(if is_circular_empty { "green" } else { "red" })
    );
    if is_circular_empty {
        println!("🚀 No circular dependencies found.");
    } else {
        println!("{}", utils::pretty::pretty_circular(&circulars, "  "));
    }

    if !args.no_warning {
        println!("\n{}", "• Warnings".bold().yellow());
        println!(
            "{}",
            utils::pretty::pretty_warning(&utils::tree::parse_warnings(&dependency_tree), "  ")
        );
    }

    if let Some(detect_unused_files_from) = args.detect_unused_files_from {
        let all_files: Vec<PathBuf> = glob(&detect_unused_files_from)
            .expect("Failed to read glob pattern")
            .filter_map(Result::ok)
            .collect();
        let short_all_files: Vec<String> = all_files
            .iter()
            .map(|v| {
                v.strip_prefix(&options.context)
                    .unwrap_or(v)
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        let unused_files: Vec<String> = short_all_files
            .iter()
            .filter(|v| !dependency_tree.contains_key(*v))
            .cloned()
            .collect();
        println!("{}", "• Unused files".bold().cyan());
        if unused_files.is_empty() {
            println!(
              "{}",
              format!(
                  "  ✅ Congratulations, no unused file was found in your project. (total: {}, used: {})",
                  all_files.len(),
                  dependency_tree.len()
              )
              .bold()
              .green()
          );
        } else {
            let len = unused_files.len().to_string().len();
            for (i, f) in unused_files.iter().enumerate() {
                println!("{:0width$}) {}", i, f, width = len);
            }
        }
    }

    for (label, code) in exit_codes {
        match label.as_str() {
            "circular" => {
                if !circulars.is_empty() {
                    std::process::exit(code);
                }
            }
            _ => {}
        }
    }

    println!("Analyze done!");
}
