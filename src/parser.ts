/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import fs from 'fs-extra';
import path from 'path';
import ts from 'typescript';
import {
  Dependency,
  DependencyKind,
  DependencyTree,
  ParseOptions,
} from './types';
import { glob, normalizeOptions, resolve, shortenTree } from './utils';

async function parseTreeRecursive(
  context: string,
  request: string,
  options: ParseOptions,
  output: DependencyTree,
): Promise<string | null> {
  const id = await resolve(context, request, options.extensions);
  if (!id || output[id]) {
    return id;
  }
  if (!options.include.test(id) || options.exclude.test(id)) {
    output[id] = null;
    return id;
  }
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
      ts.isStringLiteral(node.arguments[0])
    ) {
      newRequest = (node.arguments[0] as ts.StringLiteral).text;
      kind = DependencyKind.DynamicImport;
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.getText() === 'require' &&
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
    jobs.push(parseTreeRecursive(newContext, newRequest, options, output));
  }

  const code = await fs.readFile(id, 'utf8');
  const source = ts.createSourceFile(
    id,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  ts.forEachChild(source, nodeVisitor);
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
  const context = process.cwd();
  const output: DependencyTree = {};
  const fullOptions = normalizeOptions(options);
  await Promise.all(
    entries.map((entry) =>
      glob(entry).then((matches) =>
        Promise.all(
          matches.map((filename) =>
            parseTreeRecursive(
              context,
              path.join(context, filename),
              fullOptions,
              output,
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
