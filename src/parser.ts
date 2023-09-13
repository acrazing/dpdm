/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import fs from 'fs-extra';
import * as G from 'glob';
import path from 'path';
import ts from 'typescript';
import { DependencyKind } from './consts';
import { Dependency, DependencyTree, ParseOptions } from './types';
import {
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
  const currentDirectory = process.cwd();
  const output: DependencyTree = {};
  const fullOptions = normalizeOptions(options);
  let resolve = simpleResolver;
  if (options.tsconfig) {
    const compilerOptions = ts.parseJsonConfigFileContent(
      ts.readConfigFile(options.tsconfig, ts.sys.readFile).config,
      ts.sys,
      path.dirname(options.tsconfig),
    ).options;

    const host = ts.createCompilerHost(compilerOptions);
    resolve = async (context, request, extensions) => {
      const module = ts.resolveModuleName(
        request,
        path.join(context, 'index.ts'),
        compilerOptions,
        host,
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
    };
  }
  await Promise.all(
    entries.map((entry) =>
      G.glob(entry).then((matches) =>
        Promise.all(
          matches.map((filename) =>
            parseTreeRecursive(
              currentDirectory,
              path.join(currentDirectory, filename),
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
