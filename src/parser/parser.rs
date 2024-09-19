use super::consts::DependencyKind;
use super::types::{Dependency, ParseOptions};
use crate::parser::types::DependencyTree;
use crate::utils::resolver::simple_resolver;
use crate::utils::shorten::shorten_tree;
use glob::glob;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use swc_common::{sync::Lrc, FileName, SourceMap};
use swc_ecma_parser::{Parser, StringInput, Syntax, TsSyntax};
use swc_ecma_visit::{Visit, VisitWith};

pub async fn parse_dependency_tree(entries: Vec<String>, options: ParseOptions) -> DependencyTree {
    let mut output: DependencyTree = HashMap::new();
    let cm = Lrc::new(SourceMap::default());

    let current_directory = fs::canonicalize(PathBuf::from(".")).unwrap();
    // 获取文件列表
    for entry in entries {
        for entry_path in glob(&entry).expect("Failed to read glob pattern") {
            println!("entry_path: {:?}", entry_path);
            match entry_path {
                Ok(filename) => {
                    let path: PathBuf = current_directory.join(filename);
                    parse_tree_recursive(
                        current_directory.clone(),
                        path,
                        &mut output,
                        &cm,
                        &options,
                    )
                    .await;
                }
                Err(e) => eprintln!("{:?}", e),
            }
        }
    }

    shorten_tree(current_directory.to_string_lossy().to_string(), output)
    // output
}

/// 递归解析文件中的依赖
async fn parse_tree_recursive(
    context: PathBuf,
    path: PathBuf,
    output: &mut DependencyTree,
    cm: &Lrc<SourceMap>,
    options: &ParseOptions,
) -> Option<String> {
    let id: Option<String> = match simple_resolver(
        context.to_string_lossy().to_string(),
        path.to_string_lossy().to_string(),
        options.extensions.clone(),
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

    // if !options.include.is_match(&id) || options.exclude.is_match(&id) {
    //     output.insert(id.clone(), None);
    //     return Some(id.clone());
    // }

    // let ext = path.extension().unwrap().to_string_lossy().to_string();
    // if !options.js.contains(&ext) {
    //     output.insert(id.clone(), None);
    //     return Some(id.clone());
    // }

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
        swc_ecma_ast::EsVersion::EsNext,
        StringInput::from(&*fm),
        None,
    );

    let mut parser: Parser<swc_ecma_parser::lexer::Lexer<'_>> = Parser::new_from(lexer);
    let module: swc_ecma_ast::Module = parser.parse_module().expect("Failed to parse module");
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
    module.visit_with(&mut collector);

    let mut deps: Vec<_> = Vec::new();
    for dep in &collector.dependencies {
        let path: PathBuf = PathBuf::from(dep.request.clone());
        let new_context: PathBuf = new_context.clone();
        let dep: Option<String> =
            Box::pin(parse_tree_recursive(new_context, path, output, cm, options)).await;
        println!("dep: {:?}", dep);
        deps.push(dep);
    }

    for (i, dep) in deps.iter().enumerate() {
        collector.dependencies[i].id = dep.clone();
    }

    // 将收集到的依赖存储到输出中
    output.insert(collector.id.clone(), Some(collector.dependencies));
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
            // 处理动态导入
            else if let swc_ecma_ast::Callee::Import(..) = expr.callee {
                println!("| export visit_call_expr: {:?}", expr);
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
        }
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

    fn visit_export_default_specifier(&mut self, export: &swc_ecma_ast::ExportDefaultSpecifier) {
        // 处理默认导出
        let dependency = Dependency {
            issuer: self.path.to_string_lossy().to_string(),
            request: String::new(),
            kind: DependencyKind::StaticExport,
            id: Some(self.id.clone()),
        };

        // Add the default export dependency to the list
        self.dependencies.push(dependency);
    }

    fn visit_export_all(&mut self, node: &swc_ecma_ast::ExportAll) {
        println!("| export visit_export_all: {:?}", node);

        let request = node.src.value.to_string();
        let dependency = Dependency {
            issuer: self.path.to_string_lossy().to_string(),
            request,
            kind: DependencyKind::StaticExport,
            id: Some(self.id.clone()),
        };
        self.dependencies.push(dependency);
    }

    fn visit_import(&mut self, node: &swc_ecma_ast::Import) {
        // DynamicImport
        let request = format!("{:?}", node.phase);
        let dependency = Dependency {
            issuer: self.path.to_string_lossy().to_string(),
            request,
            kind: DependencyKind::DynamicImport,
            id: Some(self.id.clone()),
        };
        self.dependencies.push(dependency);
    }
}
