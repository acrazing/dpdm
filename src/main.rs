mod parser;
mod utils;

use clap::Parser;
use glob::glob;
use indicatif::ProgressBar;
use parser::parser::parse_dependency_tree;
use regex::Regex;
use std::collections::HashSet;
use std::fs::File;
use std::path::{Path, PathBuf};
use utils::path::join_paths;
use utils::resolver::simple_resolver;

use parser::types::ParseOptions;

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
    #[arg(long, default_value = "true")]
    tree: bool,

    /// Print circular to stdout
    #[arg(long, default_value = "true")]
    circular: bool,

    /// Print warning to stdout
    #[arg(long, default_value = "true")]
    warning: bool,

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
    progress: bool,

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

    // let pb: ProgressBar = ProgressBar::new(100); // 假设总进度为100，可以根据实际情况调整
    // pb.set_style(
    //     ProgressStyle::default_bar()
    //         .template("{msg} [{bar:40}] {percent}%")
    //         .progress_chars("##-"),
    // );

    // pb.set_message("Start analyzing dependencies...");
    // pb.enable_steady_tick(100);
    // pb.finish_with_message("Analysis complete!");

    // let mut total: i32 = 0;
    // let mut ended: i32 = 0;
    // let mut current: String = String::new();

    let context: String = args.context.as_ref().map(|s| s.clone()).unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned()
    });

    fn on_progress(
        event: &str,
        target: &str,
        total: &mut usize,
        ended: &mut usize,
        current: &mut String,
        progress_bar: &ProgressBar,
    ) {
        match event {
            "start" => {
                *total += 1;
                *current = Path::new(target).display().to_string(); // 使用相对路径
            }
            "end" => {
                *ended += 1;
            }
            _ => {}
        }
        if !progress_bar.is_hidden() {
            let message = format!("[{}/{}] Analyzing {}...", *ended, *total, current);
            progress_bar.set_message(message);
        }
    }

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
        on_progress, // 使用之前定义的 on_progress 函数
    };

    println!("args.tsconfig: {:?}", args.tsconfig);

    let dependency_tree = parse_dependency_tree(&files, &options).await;

    if utils::tree::is_empty(&dependency_tree) {
        println!("No entry files were matched.");
        std::process::exit(1);
    }

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
            }
        }))
        .await
        .into_iter()
        .collect();

    let clone_dependency_tree = dependency_tree.clone();

    let circulars = utils::tree::parse_circular(dependency_tree, options.skip_dynamic_imports);

    if circulars.is_empty() {
        println!("No circular dependencies found. {:?}", circulars);
    } else {
        println!("Circular dependencies found: {:?}", circulars);
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

    let file = File::create("tree-rs.json").expect("Failed to create file");
    serde_json::to_writer_pretty(file, &clone_dependency_tree).expect("Failed to write JSON");

    println!("Analyze done!");
}
