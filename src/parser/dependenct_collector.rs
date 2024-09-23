use super::consts::DependencyKind;
use super::types::Dependency;
use std::path::PathBuf;
use swc_ecma_ast::Callee;
use swc_ecma_visit::{Visit, VisitWith};

pub struct DependencyCollector {
    pub path: PathBuf,
    pub dependencies: Vec<Dependency>,
    pub id: String,
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
