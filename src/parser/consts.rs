#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyKind {
    CommonJS,
    StaticImport,
    DynamicImport,
    StaticExport,
}
