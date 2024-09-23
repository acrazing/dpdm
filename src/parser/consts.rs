#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum DependencyKind {
    CommonJS,
    StaticImport,
    DynamicImport,
    StaticExport,
}
