/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:59
 */

import { DependencyKind } from './consts';

export interface ParseOptions {
  cwd: string;
  context: string;
  extensions: string[];
  js: string[];
  include: RegExp;
  exclude: RegExp;
  tsconfig: string | undefined;
  onProgress: (event: 'start' | 'end', target: string) => void;
  transform: boolean;
  skipDynamicImports: boolean;
}

export interface WarningOptions {
  ignoreMissWarnings: RegExp[];
  ignoreSkipWarnings: RegExp[];
}

export interface Config {
  files?: string | string[];
  cwd?: string;
  context?: string;
  extensions?: string | string[];
  js?: string | string[];
  include?: string | RegExp;
  exclude?: string | RegExp;
  output?: string;
  tree?: boolean;
  circular?: boolean;
  warning?: boolean;
  tsconfig?: string;
  transform?: boolean;
  exitCode?: string;
  progress?: boolean;
  detectUnusedFilesFrom?: string;
  skipDynamicImports?: 'tree' | 'circular';
  skipImports?: string | string[];
  groupByPackage?: boolean;
  ignoreMissWarning?: string | string[];
  ignoreMissWarnings?: string | string[];
  ignoreSkipWarning?: string | string[];
  ignoreSkipWarnings?: string | string[];
}

export interface Dependency {
  issuer: string;
  request: string;
  kind: DependencyKind;
  id: string | null; // filename or shorten filename, cannot resolve will be null
}

/**
 * id status warning:
 *
 * 1. id === null:        cannot resolve
 * 2. tree[id] === null:  ignored
 */
export type DependencyTree = Record<string, ReadonlyArray<Dependency> | null>;

export interface OutputResult {
  entries: string[];
  tree: DependencyTree;
  circulars: string[][];
}
