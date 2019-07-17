/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:59
 */

export interface ParseOptions {
  context: string;
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
  result: string;
}

export type DependencyTree = Record<string, Dependency[]>;

export interface OutputResult {
  circular: string[][];
  tree: DependencyTree;
  entries: string[];
}
