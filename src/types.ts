/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:59
 */

export interface ParseOptions {
  context: string | null;
  extensions: string[];
  include: RegExp;
  exclude: RegExp;
}

export enum DependencyKind {
  CommonJS = 'CommonJS', // require
  StaticImport = 'StaticImport', // import ... from "foo"
  DynamicImport = 'DynamicImport', // import("foo")
  StaticExport = 'StaticExport', // export ... from "foo"
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
