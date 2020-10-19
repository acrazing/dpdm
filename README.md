# dpdm

A static dependencies analyzer for your `JavaScript` and `TypeScript` projects.

## Features

- Supports `CommonJS`, `ESM`.
- Supports `JavaScript` and `TypeScript` completely.
  - Supports TypeScript [path mapping](https://www.typescriptlang.org/docs/handbook/module-resolution.html#path-mapping).
  - Supports ignore TypeScript type dependency
- Light weight: use [typescript](https://npmjs.com/package/typescript) to parse all modules.
- Fast: use asynchronous API to load modules.
- Stable output: This is compared to madge, whose results are completely inconclusive when analyze `TypeScript`.

## Install

```bash
npm i dpdm # or yarn add dpdm

# use as command line
npm i -g dpdm # or yarn global add dpdm
dpdm --help
```

## Usage in line

```bash
dpdm.ts [options] files...

Options:
  --version            Show version number                                                 [boolean]
  --context            the context directory to shorten path, default is current directory  [string]
  --extensions, --ext  comma separated extensions to resolve
                                                  [string] [default: ".ts,.tsx,.mjs,.js,.jsx,.json"]
  --js                 comma separated extensions indicate the file is js like
                                                        [string] [default: ".ts,.tsx,.mjs,.js,.jsx"]
  --include            included filenames regexp in string, default includes all files
                                                                            [string] [default: ".*"]
  --exclude            excluded filenames regexp in string, set as empty string to include all files
                                                              [string] [default: "\/node_modules\/"]
  --output, -o         output json to file                                                  [string]
  --tree               print tree to stdout                                [boolean] [default: true]
  --circular           print circular to stdout                            [boolean] [default: true]
  --warning            print warning to stdout                             [boolean] [default: true]
  --tsconfig           the tsconfig path, which is used for resolve path alias, default is
                       tsconfig.json if it exists in context directory                      [string]
  --transform, -T      transform typescript modules to javascript before analyze, it allows you to
                       omit types dependency in typescript                [boolean] [default: false]
  --exit-code          exit with specified code, the value format is CASE:CODE, `circular` is the
                       only supported CASE, CODE should be a integer between 0 and 128. For example:
                       `dpdm --exit-code circular:1` the program will exit with code 1 if circular
                       dependency found.                                                    [string]
  -h, --help           Show help                                                           [boolean]
```

> The result example:
> ![](./assets/screenshot.png)

## Usage in module

```typescript jsx
import { parseDependencyTree, parseCircular, prettyCircular } from 'dpdm';

parseDependencyTree('./index', {
  /* options, see below */
}).then((tree) => {
  const circulars = parseCircular(tree);
  console.log(prettyCircular(circulars));
});
```

## API

1. `parseDependencyTree(entries, option, output)`: parse dependencies for glob entries

   ```typescript jsx
   /**
    * @param entries - the glob entries to match
    * @param options - the options, see below
    */
   export declare function parseDependencyTree(
     entries: string | string[],
     options: ParserOptions,
   ): Promise<DependencyTree>;

   /**
    * the parse options
    */
   export interface ParseOptions {
     context: string; // context to shorten filename,           default is process.cwd()
     extensions: string[]; // the custom extensions to resolve file, default is [ '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json' ]
     include: RegExp; // the files to parse match regex,        default is /\.m?[tj]sx?$/
     exclude: RegExp; // the files to ignore parse,             default is /\/node_modules\//
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
     id: string | null; // the shortened, resolved filename, if cannot resolve, it will be null
   }

   // the parse tree result, key is file id, value is its dependencies
   // if file is ignored, it will be null
   export type DependencyTree = Record<string, Dependency[] | null>;
   ```

2. `parseCircular(tree)`: parse circulars in dependency tree

   ```typescript jsx
   export declare function parseCircular(tree: DependencyTree): string[][];
   ```

## TODO

- [ ] Supports HTML and HTML like modules
- [ ] Supports CSS and CSS like modules
- [ ] Prints interactive SVG

## LICENSE

[MIT](./LICENSE)
