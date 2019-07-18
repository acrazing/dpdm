/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import G from 'glob';
import path from 'path';
import util from 'util';
import { Dependency, DependencyTree, ParseOptions } from './types';

export const glob = util.promisify(G);

export const defaultOptions: ParseOptions = {
  context: process.cwd(),
  extensions: ['', '.js', '.jsx', '.ts', '.tsx', '.json'],
  include: /\.[tj]sx?$/,
  exclude: /\/node_modules\//,
};

export function normalizeOptions(options: Partial<ParseOptions>): ParseOptions {
  const newOptions = { ...defaultOptions, ...options };
  if (newOptions.extensions.indexOf('') < 0) {
    newOptions.extensions.unshift('');
  }
  return newOptions;
}

export async function appendSuffix(
  request: string,
  extensions: string[],
): Promise<string | null> {
  for (const ext of extensions) {
    try {
      const stat = await fs.stat(request + ext);
      if (stat.isFile()) {
        return request + ext;
      } else if (stat.isDirectory() && ext === '') {
        // ignore package.json
        return appendSuffix(path.join(request, 'index'), extensions);
      }
    } catch {
      // pass
    }
  }
  return null;
}

export async function resolve(
  context: string,
  request: string,
  extensions: string[],
) {
  if (path.isAbsolute(request)) {
    return appendSuffix(request, extensions);
  }
  if (request.charAt(0) === '.') {
    return appendSuffix(path.join(context, request), extensions);
  }
  // is package
  const nodePath = { paths: [context] };
  try {
    return require.resolve(request, nodePath);
  } catch (e) {
    try {
      const pkgPath = require.resolve(
        path.join(request, 'package.json'),
        nodePath,
      );
      const pkgModule = (await fs.readJSON(pkgPath)).module;
      return typeof pkgModule === 'string'
        ? path.join(path.dirname(pkgPath), pkgModule)
        : null;
    } catch (e) {
      return null;
    }
  }
}

export function shortenTree(
  context: string,
  tree: DependencyTree,
): DependencyTree {
  const output: DependencyTree = {};
  for (const key in tree) {
    const shortKey = path.relative(context, key);
    output[shortKey] = tree[key]
      ? tree[key]!.map(
          (item) =>
            ({
              ...item,
              issuer: shortKey,
              id: item.id === null ? null : path.relative(context, item.id),
            } as Dependency),
        )
      : null;
  }
  return output;
}

export function parseCircular(tree: DependencyTree): string[][] {
  const circulars: string[][] = [];

  tree = { ...tree };

  function visit(id: string, used: string[]) {
    const index = used.indexOf(id);
    if (index > -1) {
      circulars.push(used.slice(index));
    } else if (tree[id]) {
      used.push(id);
      const deps = tree[id];
      delete tree[id];
      deps &&
        deps.forEach((dep) => {
          dep.id && visit(dep.id, used.slice());
        });
    }
  }

  for (const id in tree) {
    visit(id, []);
  }
  return circulars;
}

export function parseWarnings(tree: DependencyTree): string[] {
  const warnings: string[] = [];
  for (const key in tree) {
    const deps = tree[key];
    if (!deps) {
      warnings.push(`ignore ${JSON.stringify(key)}`);
    } else {
      for (const dep of deps) {
        if (!dep.id) {
          warnings.push(
            `lose ${JSON.stringify(dep.request)} from ${JSON.stringify(
              dep.issuer,
            )}`,
          );
        }
      }
    }
  }
  return warnings.sort();
}

export function prettyTree(
  tree: DependencyTree,
  entries: string[],
  prefix = '  ',
) {
  const lines: string[] = [];
  let id = 0;
  const idMap: Record<string, number> = {};
  const digits = Math.ceil(Math.log10(Object.keys(tree).length));

  function visit(item: string, prefix: string) {
    const isNew = idMap[item] === void 0;
    const iid = (idMap[item] = idMap[item] || id++);
    let line = chalk.dim(
      prefix + '- ' + iid.toString().padStart(digits, '0') + ') ',
    );
    const deps = tree[item];
    if (!isNew) {
      lines.push(line + chalk.dim(item));
      return;
    } else if (!deps) {
      lines.push(line + chalk.yellowBright(item));
      return;
    }
    lines.push(line + chalk.whiteBright(item));
    prefix += '    ';
    for (const dep of deps) {
      visit(dep.id || dep.request, prefix);
    }
  }

  for (const item of entries) {
    visit(item, prefix);
  }

  return lines.join('\n');
}

export function prettyCircular(circulars: string[][], prefix = '  ') {
  const digits = Math.ceil(Math.log10(circulars.length));
  return circulars
    .map((line, index) => {
      return (
        chalk.dim(
          `${prefix}${(index + 1).toString().padStart(digits, '0')}) `,
        ) + line.map((item) => chalk.cyanBright(item)).join(chalk.dim(' -> '))
      );
    })
    .join('\n');
}

export function prettyWarning(warnings: string[], prefix = '  ') {
  const digits = Math.ceil(Math.log10(warnings.length));
  return warnings
    .map((line, index) => {
      return (
        chalk.dim(
          `${prefix}${(index + 1).toString().padStart(digits, '0')}) `,
        ) + chalk.yellowBright(line)
      );
    })
    .join('\n');
}
