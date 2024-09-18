use crate::parser::types::ParseOptions;
use regex::Regex;
use std::path::PathBuf;

pub fn normalize_options(options: Option<ParseOptions>) -> ParseOptions {
    let mut new_options = ParseOptions {
        context: std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        extensions: vec![
            "".to_string(),
            ".ts".to_string(),
            ".tsx".to_string(),
            ".mjs".to_string(),
            ".js".to_string(),
            ".jsx".to_string(),
            ".json".to_string(),
        ],
        js: vec![
            ".ts".to_string(),
            ".tsx".to_string(),
            ".mjs".to_string(),
            ".js".to_string(),
            ".jsx".to_string(),
        ],
        include: Regex::new(".*").unwrap(),
        exclude: Regex::new("node_modules").unwrap(),
        tsconfig: None,
        transform: false,
        skip_dynamic_imports: false,
        on_progress: |_, _, _, _, _, _| {},
    };

    if let Some(opts) = options {
        new_options.extensions.extend(opts.extensions);
        new_options.context = opts.context;
        new_options.tsconfig = opts.tsconfig;
        new_options.transform = opts.transform;
        new_options.skip_dynamic_imports = opts.skip_dynamic_imports;
        new_options.on_progress = opts.on_progress;
    }

    if !new_options.extensions.contains(&"".to_string()) {
        new_options.extensions.insert(0, "".to_string());
    }

    new_options.context = PathBuf::from(new_options.context)
        .canonicalize()
        .unwrap()
        .to_string_lossy()
        .into_owned();

    if new_options.tsconfig.is_none() {
        let tsconfig_path = PathBuf::from(&new_options.context).join("tsconfig.json");
        if tsconfig_path.is_file() {
            new_options.tsconfig = Some(tsconfig_path.to_string_lossy().into_owned());
        }
    } else {
        let tsconfig_path = PathBuf::from(new_options.tsconfig.as_ref().unwrap());
        if !tsconfig_path.is_file() {
            panic!(
                "specified tsconfig \"{}\" is not a file",
                tsconfig_path.display()
            );
        }
    }

    new_options
}
