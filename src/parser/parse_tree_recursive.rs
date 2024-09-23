use super::dependenct_collector::DependencyCollector;
use super::types::{Alias, Dependency, IsModule, ParseOptions};
use crate::parser::types::DependencyTree;
use crate::utils::resolver::simple_resolver;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use swc_common::{sync::Lrc, FileName, Mark, SourceMap};
use swc_common::{Globals, GLOBALS};
use swc_ecma_ast::{EsVersion, Program};
use swc_ecma_parser::{Parser, StringInput, Syntax, TsSyntax};
use swc_ecma_transforms_base::resolver;
use swc_ecma_transforms_typescript::strip;
use swc_ecma_visit::{FoldWith, VisitWith};

pub async fn parse_tree_recursive(
    context: PathBuf,
    path: PathBuf,
    output: Arc<Mutex<DependencyTree>>,
    cm: &Lrc<SourceMap>,
    options: &ParseOptions,
    alias: Option<&Alias>,
) -> Option<String> {
    let id: Option<String> = match simple_resolver(
        &context.to_string_lossy().to_string(),
        &path.to_string_lossy().to_string(),
        &options.extensions,
        alias,
    )
    .await
    {
        Ok(id) => id,
        Err(e) => {
            eprintln!("{:?}", e);
            return None;
        }
    };

    let id: String = match id {
        Some(id) => {
            let output_lock = output.lock().unwrap();
            if output_lock.contains_key(&id) {
                return Some(id);
            }
            id
        }
        None => {
            return None;
        }
    };

    if !options.include.is_match(&id) || options.exclude.is_match(&id) {
        let mut output_lock = output.lock().unwrap();
        output_lock.insert(id.clone(), None);
        return Some(id.clone());
    }

    match Path::new(&id).extension() {
        Some(ext) => {
            let ext: String = if ext.to_string_lossy().to_string() == "" {
                String::new()
            } else {
                format!(".{}", ext.to_string_lossy().to_string())
            };
            if !options.js.contains(&ext) {
                let mut output_lock = output.lock().unwrap();
                output_lock.insert(id.clone(), Some(Vec::new()));
                return Some(id.clone());
            }
        }
        None => {
            let mut output_lock = output.lock().unwrap();
            output_lock.insert(id.clone(), Some(Vec::new()));
            return Some(id.clone());
        }
    }

    if let Some(progress) = &options.progress {
        {
            let mut total = progress.total.lock().unwrap();
            *total += 1;
        }
        {
            let mut current = progress.current.lock().unwrap();
            *current = id.clone();
        }
        {
            let mut spinner = progress.spinner.lock().unwrap();
            let text = format!(
                "[{}/{}] Analyzing {}...",
                *progress.ended.lock().unwrap(),
                *progress.total.lock().unwrap(),
                *progress.current.lock().unwrap()
            );
            spinner.update_text(text);
        }
    }

    let file_content = fs::read_to_string(&id).expect("Unable to read file");
    let id_path: PathBuf = Path::new(&id).to_path_buf();

    // 使用 swc 解析代码
    let fm: Lrc<swc_common::SourceFile> =
        cm.new_source_file(FileName::Real(id_path.clone()).into(), file_content);
    let lexer = swc_ecma_parser::lexer::Lexer::new(
        Syntax::Typescript(TsSyntax {
            tsx: true,
            decorators: false,
            ..Default::default()
        }),
        EsVersion::EsNext,
        StringInput::from(&*fm),
        None,
    );

    let mut parser: Parser<swc_ecma_parser::lexer::Lexer<'_>> = Parser::new_from(lexer);
    let program_result = match options.is_module {
        IsModule::Bool(true) => parser.parse_module().map(Program::Module),
        IsModule::Bool(false) => parser.parse_script().map(Program::Script),
        IsModule::Unknown => parser.parse_program(),
    };

    let program = match program_result {
        Ok(program) => program,
        Err(_err) => {
            // eprintln!("Failed to parse program: {:?}", err);
            return None;
        }
    };

    let program = match options.transform {
        true => match id.ends_with(".tsx") || id.ends_with(".ts") {
            true => {
                let program = GLOBALS.set(&Globals::new(), || {
                    let unresolved_mark = Mark::new();
                    let top_level_mark = Mark::new();

                    let program =
                        program.fold_with(&mut resolver(unresolved_mark, top_level_mark, true));
                    let program = program.fold_with(&mut strip(top_level_mark, unresolved_mark));
                    program
                });
                program
            }
            false => program,
        },
        false => program,
    };

    let new_context: PathBuf = Path::new(&id).parent().unwrap().to_path_buf();

    let dependencies: Vec<Dependency> = Vec::new();
    {
        let mut output_lock = output.lock().unwrap();
        output_lock.insert(id.clone(), Some(Vec::new()));
    }

    // 创建一个依赖收集器
    let mut collector: DependencyCollector = DependencyCollector {
        id,
        path: path.clone(),
        dependencies,
    };

    // 遍历 AST
    program.visit_with(&mut collector);

    let mut deps: Vec<_> = Vec::new();
    for dep in &collector.dependencies {
        let path: PathBuf = PathBuf::from(dep.request.clone());
        let new_context: PathBuf = new_context.clone();
        let output_clone = Arc::clone(&output);
        let dep: Option<String> = Box::pin(parse_tree_recursive(
            new_context,
            path,
            output_clone,
            cm,
            options,
            alias,
        ))
        .await;
        deps.push(dep);
    }

    for (i, dep) in deps.iter().enumerate() {
        collector.dependencies[i].id = dep.clone();
    }

    // 将收集到的依赖存储到输出中
    {
        let mut output_lock = output.lock().unwrap();
        output_lock.insert(collector.id.clone(), Some(collector.dependencies));
    }

    if let Some(progress) = &options.progress {
        {
            let mut ended = progress.ended.lock().unwrap();
            *ended += 1;
        }
        {
            let mut spinner = progress.spinner.lock().unwrap();
            let text = format!(
                "[{}/{}] Analyzing {}...",
                *progress.ended.lock().unwrap(),
                *progress.total.lock().unwrap(),
                *progress.current.lock().unwrap()
            );
            spinner.update_text(text);
        }
    }
    Some(collector.id.clone())
}
