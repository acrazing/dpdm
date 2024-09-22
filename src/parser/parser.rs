use super::consts::DependencyKind;
use super::types::{Alias, Dependency, IsModule, ParseOptions};
use crate::parser::types::DependencyTree;
use crate::utils::options::normalize_options;
use crate::utils::path::join_paths;
use crate::utils::resolver::simple_resolver;
use crate::utils::shorten::shorten_tree;
use glob::glob;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use swc_common::{sync::Lrc, FileName, Mark, SourceMap};
use swc_common::{Globals, GLOBALS};
use swc_ecma_ast::{Callee, EsVersion, Program};
use swc_ecma_parser::{Parser, StringInput, Syntax, TsSyntax};
use swc_ecma_transforms_base::resolver;
use swc_ecma_transforms_typescript::strip;
use swc_ecma_visit::{FoldWith, Visit, VisitWith};

pub async fn parse_dependency_tree(
    entries: &Vec<String>,
    base_options: &ParseOptions,
) -> DependencyTree {
    let options: ParseOptions = normalize_options(Some((*base_options).clone()));

    let tsconfig_json = match options.tsconfig.clone() {
        Some(tsconfig) => {
            let tsconfig_data: serde_json::Value = match fs::read_to_string(PathBuf::from(tsconfig))
            {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(json) => json,
                    Err(e) => {
                        eprintln!("Failed to parse tsconfig.json: {:?}", e);
                        return HashMap::new();
                    }
                },
                Err(e) => {
                    eprintln!("Failed to read tsconfig.json: {:?}", e);
                    return HashMap::new();
                }
            };
            tsconfig_data
        }
        None => {
            return HashMap::new();
        }
    };

    let current_directory = fs::canonicalize(PathBuf::from(".")).unwrap();
    let root = match tsconfig_json
        .get("compilerOptions")
        .and_then(|co| co.get("baseUrl"))
        .and_then(|bu| bu.as_str())
    {
        Some(base_url) => {
            let base_url: PathBuf = PathBuf::from(base_url);
            join_paths(&[&current_directory, &base_url])
        }
        None => current_directory.clone(),
    };

    let paths = match tsconfig_json
        .get("compilerOptions")
        .and_then(|co| co.get("paths"))
    {
        Some(paths) => paths,
        None => &serde_json::Value::Null,
    };

    let alias: Alias = Alias {
        root,
        paths: paths
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| {
                let values = v
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|val| val.as_str().unwrap().to_string())
                    .collect();
                (k.clone(), values)
            })
            .collect(),
    };

    let mut output: DependencyTree = HashMap::new();
    let cm = Lrc::new(SourceMap::default());

    // 获取文件列表
    for entry in entries {
        for entry_path in glob(&entry).expect("Failed to read glob pattern") {
            match entry_path {
                Ok(filename) => {
                    let path: PathBuf = current_directory.join(filename);
                    parse_tree_recursive(
                        current_directory.clone(),
                        path,
                        &mut output,
                        &cm,
                        &options,
                        &alias,
                    )
                    .await;
                }
                Err(e) => eprintln!("{:?}", e),
            }
        }
    }

    shorten_tree(&current_directory.to_string_lossy().to_string(), &output)
}

/// 递归解析文件中的依赖
async fn parse_tree_recursive(
    context: PathBuf,
    path: PathBuf,
    output: &mut DependencyTree,
    cm: &Lrc<SourceMap>,
    options: &ParseOptions,
    alias: &Alias,
) -> Option<String> {
    let id: Option<String> = match simple_resolver(
        &context.to_string_lossy().to_string(),
        &path.to_string_lossy().to_string(),
        &options.extensions,
        Some(&alias),
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
            if output.contains_key(&id) {
                return Some(id);
            }
            id
        }
        None => {
            return None;
        }
    };

    if !options.include.is_match(&id) || options.exclude.is_match(&id) {
        output.insert(id.clone(), None);
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
                output.insert(id.clone(), Some(Vec::new()));
                return Some(id.clone());
            }
        }
        None => {
            output.insert(id.clone(), Some(Vec::new()));
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
    output.insert(id.clone(), Some(Vec::new()));

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
        let dep: Option<String> = Box::pin(parse_tree_recursive(
            new_context,
            path,
            output,
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
    output.insert(collector.id.clone(), Some(collector.dependencies));

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

struct DependencyCollector {
    path: PathBuf,
    dependencies: Vec<Dependency>,
    id: String,
}

impl Visit for DependencyCollector {
    fn visit_import_decl(&mut self, import: &swc_ecma_ast::ImportDecl) {
        // 处理静态导入
        let request = import.src.value.to_string();
        let dependency = Dependency {
            issuer: self.path.to_string_lossy().to_string(),
            request,
            kind: DependencyKind::StaticImport,
            id: Some(self.id.clone()),
        };
        self.dependencies.push(dependency);
    }

    fn visit_call_expr(&mut self, expr: &swc_ecma_ast::CallExpr) {
        if let Callee::Import(_) = &expr.callee {
            if let Some(arg) = expr.args.get(0) {
                if let swc_ecma_ast::Expr::Lit(swc_ecma_ast::Lit::Str(ref s)) = *arg.expr {
                    let request = s.value.to_string();
                    let dependency = Dependency {
                        issuer: self.path.to_string_lossy().to_string(),
                        request,
                        kind: DependencyKind::DynamicImport,
                        id: Some(self.id.clone()),
                    };
                    self.dependencies.push(dependency);
                }
            }
        }

        if let swc_ecma_ast::Callee::Expr(ref callee_expr) = expr.callee {
            // 处理 CommonJS 导入
            if let swc_ecma_ast::Expr::Ident(ref ident) = &**callee_expr {
                if ident.sym == *"require" {
                    if let Some(arg) = expr.args.get(0) {
                        if let swc_ecma_ast::Expr::Lit(swc_ecma_ast::Lit::Str(ref s)) = *arg.expr {
                            let request = s.value.to_string();
                            let dependency = Dependency {
                                issuer: self.path.to_string_lossy().to_string(),
                                request,
                                kind: DependencyKind::CommonJS,
                                id: Some(self.id.clone()),
                            };
                            self.dependencies.push(dependency);
                        }
                    }
                }
            }
        }
        expr.visit_children_with(self);
    }

    fn visit_export_named_specifier(&mut self, export: &swc_ecma_ast::ExportNamedSpecifier) {
        // 处理静态导出
        if let Some(src) = &export.exported {
            let request = match src {
                swc_ecma_ast::ModuleExportName::Ident(ident) => ident.sym.to_string(),
                swc_ecma_ast::ModuleExportName::Str(s) => s.value.to_string(),
            };

            let dependency = Dependency {
                issuer: self.path.to_string_lossy().to_string(),
                request,
                kind: DependencyKind::StaticExport,
                id: Some(self.id.clone()),
            };
            self.dependencies.push(dependency);
        }
    }

    fn visit_export_all(&mut self, node: &swc_ecma_ast::ExportAll) {
        let request = node.src.value.to_string();
        let dependency = Dependency {
            issuer: self.path.to_string_lossy().to_string(),
            request,
            kind: DependencyKind::StaticExport,
            id: Some(self.id.clone()),
        };
        self.dependencies.push(dependency);
    }
}
