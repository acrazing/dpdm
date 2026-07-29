/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';
import { DependencyKind } from './consts';
import { Dependency, DependencyTree, ParseOptions } from './types';
import {
  globFiles,
  normalizeOptions,
  Resolver,
  shortenTree,
  simpleResolver,
} from './utils';

const typescriptTransformOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.Preserve,
  isolatedModules: true,
};

interface TsConfigProject {
  dir: string;
  options: ts.CompilerOptions;
  host: ts.CompilerHost;
}

function readTsConfig(tsconfig: string): any {
  const result = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (result.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(result.error.messageText, '\n'),
    );
  }
  return result.config;
}

function parseTsConfigProject(tsconfig: string): TsConfigProject {
  const config = readTsConfig(tsconfig);
  const dir = path.dirname(tsconfig);
  const options = ts.parseJsonConfigFileContent(config, ts.sys, dir).options;
  return {
    dir,
    options,
    host: ts.createCompilerHost(options),
  };
}

function resolveReferenceTsConfig(base: string, referencePath: string): string {
  const target = path.resolve(base, referencePath);
  return path.extname(target) ? target : path.join(target, 'tsconfig.json');
}

function loadTsConfigProjects(tsconfig: string): TsConfigProject[] {
  const seen = new Set<string>();
  const projects: TsConfigProject[] = [];

  function visit(current: string) {
    const fullPath = path.resolve(current);
    if (seen.has(fullPath)) {
      return;
    }
    seen.add(fullPath);

    const config = readTsConfig(fullPath);
    projects.push(parseTsConfigProject(fullPath));

    for (const reference of config.references || []) {
      if (reference && typeof reference.path === 'string') {
        visit(resolveReferenceTsConfig(path.dirname(fullPath), reference.path));
      }
    }
  }

  visit(tsconfig);
  return projects;
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..'));
}

function findProjectForContext(
  projects: TsConfigProject[],
  context: string,
): TsConfigProject {
  return (
    projects
      .filter((project) => isInsidePath(project.dir, context))
      .sort((a, b) => b.dir.length - a.dir.length)[0] || projects[0]
  );
}

function findNearestTsConfig(context: string): string | null {
  let current = context;

  while (true) {
    const tsconfig = path.join(current, 'tsconfig.json');
    try {
      if (fs.statSync(tsconfig).isFile()) {
        return tsconfig;
      }
    } catch {}

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function createTsConfigResolver(options: ParseOptions): Resolver | undefined {
  const projectCache = new Map<string, TsConfigProject[]>();
  const nearestTsConfigCache = new Map<string, string | null>();

  function getProjects(context: string): TsConfigProject[] | undefined {
    const tsconfig =
      options.tsconfig ||
      (() => {
        const cached = nearestTsConfigCache.get(context);
        if (cached !== void 0) {
          return cached;
        }
        const nearest = findNearestTsConfig(context);
        nearestTsConfigCache.set(context, nearest);
        return nearest;
      })();

    if (!tsconfig) {
      return undefined;
    }
    let projects = projectCache.get(tsconfig);
    if (!projects) {
      projects = loadTsConfigProjects(tsconfig);
      projectCache.set(tsconfig, projects);
    }
    return projects;
  }

  return async (context, request, extensions) => {
    const projects = getProjects(context);
    if (projects) {
      const project = findProjectForContext(projects, context);
      const module = ts.resolveModuleName(
        request,
        path.join(context, 'index.ts'),
        project.options,
        project.host,
      ).resolvedModule;
      if (module && module.extension !== ts.Extension.Dts) {
        return module.resolvedFileName;
      } else {
        const filename = await simpleResolver(context, request, extensions);
        if (filename === null && module) {
          return simpleResolver(
            context,
            module.resolvedFileName.slice(0, -ts.Extension.Dts.length),
            extensions,
          );
        }
        return filename;
      }
    }

    return simpleResolver(context, request, extensions);
  };
}

function hasDpdmIgnoreLeadingComment(
  source: ts.SourceFile,
  node: ts.Node,
): boolean {
  return (
    ts
      .getLeadingCommentRanges(source.text, node.getFullStart())
      ?.some((comment) =>
        source.text.slice(comment.pos, comment.end).includes('@dpdm-ignore'),
      ) || false
  );
}

function findCommentTarget(node: ts.Node): ts.Node {
  if (!ts.isCallExpression(node)) {
    return node;
  }

  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    current = current.parent;
    if (ts.isStatement(current)) {
      return current;
    }
  }
  return node;
}

function isDpdmIgnored(source: ts.SourceFile, node: ts.Node): boolean {
  const commentTarget = findCommentTarget(node);
  return (
    hasDpdmIgnoreLeadingComment(source, node) ||
    (commentTarget !== node &&
      hasDpdmIgnoreLeadingComment(source, commentTarget))
  );
}

async function parseTreeRecursive(
  context: string,
  request: string,
  options: ParseOptions,
  output: DependencyTree,
  resolve: Resolver,
): Promise<string | null> {
  const id = await resolve(context, request, options.extensions);
  if (!id || output[id]) {
    return id;
  }
  if (!options.include.test(id) || options.exclude.test(id)) {
    output[id] = null;
    return id;
  }
  if (options.js.indexOf(path.extname(id)) === -1) {
    output[id] = [];
    return id;
  }
  options.onProgress('start', id);
  const dependencies: Dependency[] = (output[id] = []);
  const jobs: Promise<string | null>[] = [];
  const newContext = path.dirname(id);

  function nodeVisitor(node: ts.Node) {
    let newRequest: string;
    let kind: DependencyKind;
    if (ts.isImportDeclaration(node)) {
      newRequest = (node.moduleSpecifier as ts.StringLiteral).text;
      kind = DependencyKind.StaticImport;
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      !options.skipDynamicImports
    ) {
      newRequest = (node.arguments[0] as ts.StringLiteral).text;
      kind = DependencyKind.DynamicImport;
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.escapedText === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      newRequest = (node.arguments[0] as ts.StringLiteral).text;
      kind = DependencyKind.CommonJS;
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      newRequest = (node.moduleSpecifier as ts.StringLiteral).text;
      kind = DependencyKind.StaticExport;
    } else {
      ts.forEachChild(node, nodeVisitor);
      return;
    }
    if (isDpdmIgnored(source!, node)) {
      return;
    }
    dependencies.push({
      issuer: id!,
      request: newRequest,
      kind: kind,
      id: null,
    });
    jobs.push(
      parseTreeRecursive(newContext, newRequest, options, output, resolve),
    );
  }

  const code = await fs.readFile(id, 'utf8');
  const ext = path.extname(id);
  let source: ts.SourceFile | undefined;
  if (
    options.transform &&
    (ext === ts.Extension.Ts || ext === ts.Extension.Tsx)
  ) {
    ts.transpileModule(code, {
      compilerOptions: typescriptTransformOptions,
      transformers: {
        after: [() => (node) => (source = node)],
      },
    });
  } else {
    source = ts.createSourceFile(
      id,
      code,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  }
  ts.forEachChild(source!, nodeVisitor);
  options.onProgress('end', id);
  return Promise.all(jobs).then((deps) => {
    deps.forEach((id, index) => (dependencies[index].id = id));
    return id;
  });
}

/**
 * @param entries - the entry glob list
 * @param options
 */
export async function parseDependencyTree(
  entries: string[] | string,
  options: Partial<ParseOptions>,
): Promise<DependencyTree> {
  if (!Array.isArray(entries)) {
    entries = [entries];
  }
  const output: DependencyTree = {};
  const fullOptions = normalizeOptions(options);
  const resolve = createTsConfigResolver(fullOptions) || simpleResolver;
  await Promise.all(
    entries.map((entry) =>
      globFiles(entry, fullOptions.cwd).then((matches) =>
        Promise.all(
          matches.map((filename) =>
            parseTreeRecursive(
              fullOptions.cwd,
              path.resolve(fullOptions.cwd, filename),
              fullOptions,
              output,
              resolve,
            ),
          ),
        ),
      ),
    ),
  );
  if (fullOptions.context) {
    return shortenTree(fullOptions.context, output);
  }
  return output;
}
