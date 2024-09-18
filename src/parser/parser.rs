use super::consts::DependencyKind;
use super::types::Dependency;
use crate::parser::types::DependencyTree;
use crate::utils::resolver::{simple_resolver, Resolver};
use glob::glob;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use swc_common::{sync::Lrc, FileName, SourceMap};
use swc_ecma_parser::{Parser, StringInput, Syntax, TsSyntax};
use swc_ecma_visit::{Visit, VisitWith};

pub fn parse_dependency_tree(entries: Vec<String>) -> DependencyTree {
    let mut output: DependencyTree = HashMap::new();
    let cm = Lrc::new(SourceMap::default());

    // 获取文件列表
    for entry in entries {
        for entry_path in glob(&entry).expect("Failed to read glob pattern") {
            match entry_path {
                Ok(path) => {
                    let path = fs::canonicalize(path).unwrap();
                    parse_tree_recursive(path, &mut output, &cm);
                }
                Err(e) => eprintln!("{:?}", e),
            }
        }
    }

    output
}
/// 递归解析文件中的依赖
fn parse_tree_recursive(
    path: PathBuf,
    output: &mut DependencyTree,
    cm: &Lrc<SourceMap>,
    // resolve: Resolver,
) {
    // 读取文件
    let file_content = fs::read_to_string(&path).expect("Unable to read file");

    // 使用 swc 解析代码
    let fm: Lrc<swc_common::SourceFile> =
        cm.new_source_file(FileName::Real(path.clone()).into(), file_content);
    let lexer = swc_ecma_parser::lexer::Lexer::new(
        Syntax::Typescript(TsSyntax {
            tsx: true, // 支持 TSX
            decorators: false,
            // dynamic_import: true,
            ..Default::default()
        }),
        swc_ecma_ast::EsVersion::EsNext,
        StringInput::from(&*fm),
        None,
    );

    let mut parser: Parser<swc_ecma_parser::lexer::Lexer<'_>> = Parser::new_from(lexer);
    let module: swc_ecma_ast::Module = parser.parse_module().expect("Failed to parse module");

    // 创建一个依赖收集器
    let mut collector: DependencyCollector = DependencyCollector {
        path: path.clone(),
        dependencies: Vec::new(),
    };

    // 遍历 AST
    module.visit_with(&mut collector);

    // 将收集到的依赖存储到输出中
    output.insert(path.to_string_lossy().to_string(), collector.dependencies);
}

struct DependencyCollector {
    path: PathBuf,
    dependencies: Vec<Dependency>,
}

pub fn resolve_path(issuer: &PathBuf, request: &str) -> Option<String> {
    let path: PathBuf = issuer.parent()?.join(request); // 使用 ? 操作符处理 None
    let canonical_path: PathBuf = fs::canonicalize(&path).ok()?; // 尝试规范化路径，失败则返回 None
    Some(canonical_path.to_string_lossy().to_string())
}

impl Visit for DependencyCollector {
    fn visit_import_decl(&mut self, import: &swc_ecma_ast::ImportDecl) {
        // 处理静态导入
        let request = import.src.value.to_string();
        let id = resolve_path(&self.path, &request);
        let dependency = Dependency {
            issuer: self.path.to_string_lossy().to_string(),
            request,
            kind: DependencyKind::StaticImport,
            id,
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
                            let id = resolve_path(&self.path, &request);
                            let dependency = Dependency {
                                issuer: self.path.to_string_lossy().to_string(),
                                request,
                                kind: DependencyKind::CommonJS,
                                id,
                            };
                            self.dependencies.push(dependency);
                        }
                    }
                }
            }
            // 处理动态导入
            else if let swc_ecma_ast::Callee::Import(..) = expr.callee {
                if let Some(arg) = expr.args.get(0) {
                    if let swc_ecma_ast::Expr::Lit(swc_ecma_ast::Lit::Str(ref s)) = *arg.expr {
                        let request = s.value.to_string();
                        let id = resolve_path(&self.path, &request);
                        let dependency = Dependency {
                            issuer: self.path.to_string_lossy().to_string(),
                            request,
                            kind: DependencyKind::DynamicImport,
                            id,
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

            let id = resolve_path(&self.path, &request);
            let dependency = Dependency {
                issuer: self.path.to_string_lossy().to_string(),
                request,
                kind: DependencyKind::StaticExport,
                id,
            };
            self.dependencies.push(dependency);
        }
    }
}
