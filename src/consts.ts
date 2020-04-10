/*!
 * Copyright 2020 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2020-04-10 10:24:45
 */

export enum DependencyKind {
  CommonJS = 'CommonJS', // require
  StaticImport = 'StaticImport', // import ... from "foo"
  DynamicImport = 'DynamicImport', // import("foo")
  StaticExport = 'StaticExport', // export ... from "foo"
}
