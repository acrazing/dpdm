/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import { decode } from '@jridgewell/sourcemap-codec';
import fs from 'fs-extra';
import path from 'path';
import {
  type Node,
  ScriptKind,
  ScriptTarget,
  type SourceFile,
  type StringLiteral,
  SyntaxKind,
} from 'typescript/ast';
import {
  isCallExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isStatement,
  isStringLiteral,
} from 'typescript/ast/is';
import { getLeadingCommentRanges } from 'typescript/ast/scanner';
import {
  API,
  JsxEmit,
  ModuleKind,
  ModuleResolutionKind,
  type RawCompilerOptions,
} from 'typescript/async';
import { DependencyKind } from './consts.js';
import { Dependency, DependencyTree, ParseOptions } from './types.js';
import {
  globFiles,
  normalizeOptions,
  Resolver,
  shortenTree,
  simpleResolver,
} from './utils.js';

type ModuleResolver = Awaited<ReturnType<API['createModuleResolver']>>;

interface TsConfigProject {
  dir: string;
  resolver: ModuleResolver;
}

function getResolverOptions(options: RawCompilerOptions): RawCompilerOptions {
  const { baseUrl, ...resolverOptions } = options;
  if (baseUrl !== undefined) {
    // Preserve baseUrl by trying it after the targets of any matching alias.
    const paths = Object.fromEntries(
      Object.entries(options.paths ?? {}).map(([pattern, targets]) => [
        pattern,
        [...targets, pattern],
      ]),
    );
    paths['*'] ??= ['*'];
    resolverOptions.paths = paths;
    resolverOptions.pathsBasePath = baseUrl;
  }

  const defaultedToNode10 =
    options.moduleResolution === undefined &&
    (options.module === ModuleKind.CommonJS ||
      (options.module === undefined &&
        (options.target === undefined ||
          options.target < ScriptTarget.ES2015)));
  if (
    options.moduleResolution === ModuleResolutionKind.Node10 ||
    defaultedToNode10
  ) {
    // Bundler without package maps preserves Node10 package subpath lookup.
    resolverOptions.moduleResolution = ModuleResolutionKind.Bundler;
    resolverOptions.resolvePackageJsonExports = false;
    resolverOptions.resolvePackageJsonImports = false;
    resolverOptions.resolveJsonModule ??=
      options.module === ModuleKind.Node20 ||
      options.module === ModuleKind.NodeNext;
  }
  return resolverOptions;
}

function resolveReferenceTsConfig(base: string, referencePath: string): string {
  const target = path.resolve(base, referencePath);
  return path.extname(target) ? target : path.join(target, 'tsconfig.json');
}

async function loadTsConfigProjects(
  tsconfig: string,
  api: API,
  resolvers: Set<ModuleResolver>,
): Promise<TsConfigProject[]> {
  const seen = new Set<string>();
  const projects: TsConfigProject[] = [];

  async function visit(current: string) {
    const fullPath = path.resolve(current);
    if (seen.has(fullPath)) {
      return;
    }
    seen.add(fullPath);

    const { config, error } = await api.readConfigFile(fullPath);
    if (error) {
      throw new Error(error.text);
    }
    const dir = path.dirname(fullPath);
    const { options, projectReferences } = await api.parseJsonConfigFileContent(
      config,
      { configDirectory: dir },
    );
    const resolver = await api.createModuleResolver(
      getResolverOptions(options),
    );
    resolvers.add(resolver);
    projects.push({ dir, resolver });

    for (const reference of projectReferences ?? []) {
      await visit(resolveReferenceTsConfig(dir, reference.path));
    }
  }

  await visit(tsconfig);
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

function createTsConfigResolver(
  options: ParseOptions,
  api: API,
  resolvers: Set<ModuleResolver>,
): Resolver {
  const projectCache = new Map<string, Promise<TsConfigProject[]>>();
  const nearestTsConfigCache = new Map<string, string | null>();

  function getProjects(
    context: string,
  ): Promise<TsConfigProject[]> | undefined {
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
      projects = loadTsConfigProjects(tsconfig, api, resolvers);
      projectCache.set(tsconfig, projects);
    }
    return projects;
  }

  return async (context, request, extensions) => {
    const projects = await getProjects(context);
    if (projects) {
      const project = findProjectForContext(projects, context);
      const { resolvedModule } = await project.resolver.resolveModuleName(
        request,
        context,
      );
      const filename = resolvedModule?.resolvedFileName;
      const declarationExtension = '.d.ts';
      if (filename && !filename.endsWith(declarationExtension)) {
        return filename;
      }
      const fallback = await simpleResolver(context, request, extensions);
      if (fallback === null && filename) {
        return simpleResolver(
          context,
          filename.slice(0, -declarationExtension.length),
          extensions,
        );
      }
      return fallback;
    }

    return simpleResolver(context, request, extensions);
  };
}

type DependencyRequest = Pick<Dependency, 'request' | 'kind'>;
type LocatedDependencyRequest = DependencyRequest & { position: number };

function collectDependencyRequests(
  source: SourceFile,
  skipDynamicImports: boolean,
): LocatedDependencyRequest[] {
  const requests: LocatedDependencyRequest[] = [];

  function hasIgnoreComment(node: Node): boolean {
    return (
      getLeadingCommentRanges(source.text, node.getFullStart())?.some(
        ({ pos, end }) => source.text.slice(pos, end).includes('@dpdm-ignore'),
      ) ?? false
    );
  }

  function isIgnored(node: Node): boolean {
    if (hasIgnoreComment(node)) {
      return true;
    }
    if (isCallExpression(node)) {
      let current = node.parent;
      while (current && current.kind !== SyntaxKind.SourceFile) {
        if (isStatement(current)) {
          return hasIgnoreComment(current);
        }
        current = current.parent;
      }
    }
    return false;
  }

  function visit(node: Node): void {
    let specifier: StringLiteral | undefined;
    let kind: DependencyKind | undefined;
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      specifier = node.moduleSpecifier;
      kind = DependencyKind.StaticImport;
    } else if (
      isExportDeclaration(node) &&
      node.moduleSpecifier &&
      isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier;
      kind = DependencyKind.StaticExport;
    } else if (isCallExpression(node)) {
      const { expression, arguments: args } = node;
      if (args.length === 1 && isStringLiteral(args[0])) {
        if (
          expression.kind === SyntaxKind.ImportKeyword &&
          !skipDynamicImports
        ) {
          specifier = args[0];
          kind = DependencyKind.DynamicImport;
        } else if (isIdentifier(expression) && expression.text === 'require') {
          specifier = args[0];
          kind = DependencyKind.CommonJS;
        }
      }
    }
    if (!specifier || kind === undefined) {
      node.forEachChild(visit);
    } else if (!isIgnored(node)) {
      requests.push({
        request: specifier.text,
        kind,
        position: specifier.getStart(source),
      });
    }
  }

  source.forEachChild(visit);
  return requests;
}

async function filterEmittedRequests(
  source: SourceFile,
  requests: LocatedDependencyRequest[],
  api: API,
): Promise<DependencyRequest[]> {
  const { sourceMapText } = await api.transpileModule(source.text, {
    // The dependency parser accepts JSX in both .ts and .tsx files.
    fileName: 'module.tsx',
    compilerOptions: {
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      jsx: JsxEmit.Preserve,
      sourceMap: true,
      verbatimModuleSyntax: false,
    },
  });
  if (!sourceMapText) {
    throw new Error(
      `TypeScript did not emit a source map for ${source.fileName}`,
    );
  }

  // Match the original literal positions so repeated requests remain distinct
  // and ignore comments stay attached to the original statements.
  const { mappings } = JSON.parse(sourceMapText) as { mappings: string };
  const unmapped = new Set(requests.map(({ position }) => position));
  const lineStarts = source.getLineStarts();
  for (const line of decode(mappings)) {
    for (const segment of line) {
      if (segment.length !== 1) {
        const position = lineStarts[segment[2]] + segment[3];
        if (unmapped.delete(position) && unmapped.size === 0) {
          return requests;
        }
      }
    }
  }
  return requests.filter(({ position }) => !unmapped.has(position));
}

async function readDependencyRequests(
  id: string,
  options: ParseOptions,
  api: API,
): Promise<DependencyRequest[]> {
  const parsed = await api.createSourceFileFromFile(id, {
    scriptKind: ScriptKind.TSX,
  });
  try {
    const { sourceFile } = parsed;
    const requests = collectDependencyRequests(
      sourceFile,
      options.skipDynamicImports,
    );
    const ext = path.extname(id);
    if (
      requests.length &&
      options.transform &&
      (ext === '.ts' || ext === '.tsx')
    ) {
      return await filterEmittedRequests(sourceFile, requests, api);
    }
    return requests;
  } finally {
    await parsed.dispose();
  }
}

async function finishJobs<T>(jobs: Promise<T>[]): Promise<T[]> {
  // The shared API can close after every sibling has finished, including on errors.
  return (await Promise.allSettled(jobs)).map((result) => {
    if (result.status === 'rejected') {
      throw result.reason;
    }
    return result.value;
  });
}

async function parseTreeRecursive(
  context: string,
  request: string,
  options: ParseOptions,
  output: DependencyTree,
  resolve: Resolver,
  api: API,
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
  const newContext = path.dirname(id);
  const requests = await readDependencyRequests(id, options, api);
  const jobs = requests.map(({ request, kind }) => {
    dependencies.push({ issuer: id, request, kind, id: null });
    return parseTreeRecursive(
      newContext,
      request,
      options,
      output,
      resolve,
      api,
    );
  });
  try {
    options.onProgress('end', id);
  } finally {
    const ids = await finishJobs(jobs);
    ids.forEach((id, index) => (dependencies[index].id = id));
  }
  return id;
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
  const api = new API();
  const resolvers = new Set<ModuleResolver>();
  const resolve = createTsConfigResolver(fullOptions, api, resolvers);
  try {
    await finishJobs(
      entries.map(async (entry) => {
        const matches = await globFiles(entry, fullOptions.cwd);
        return finishJobs(
          matches.map((filename) =>
            parseTreeRecursive(
              fullOptions.cwd,
              path.resolve(fullOptions.cwd, filename),
              fullOptions,
              output,
              resolve,
              api,
            ),
          ),
        );
      }),
    );
  } finally {
    try {
      await finishJobs(Array.from(resolvers, (resolver) => resolver.dispose()));
    } finally {
      await api.close();
    }
  }
  if (fullOptions.context) {
    return shortenTree(fullOptions.context, output);
  }
  return output;
}
