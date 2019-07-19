# dpdm

A static dependencies analyzer for CommonJS/ESM.

## Features

- Support `CommonJS` and `ES Module`.
- Support `JavaScript` and `TypeScript` completely.
- Light weight: use TypeScript to parse all modules.
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
$ dpdm --help

dpdm [<options>] entry...

Options:
  --version            Show version number                                                                     [boolean]
  --context            the context directory to shorten path, default is process.cwd()                          [string]
  --extensions, --ext  comma separated extensions to resolve          [string] [default: ".ts,.tsx,.mjs,.js,.jsx,.json"]
  --include            included filenames regexp in string                              [string] [default: "\.[tj]sx?$"]
  --exclude            excluded filenames regexp in string                          [string] [default: "/node_modules/"]
  --output, -o         output json to file                                                                      [string]
  --tree               print tree to stdout                                                    [boolean] [default: true]
  --circular           print circular to stdout                                                [boolean] [default: true]
  --warning            print warning to stdout                                                 [boolean] [default: true]
  -h, --help           Show help                                                                               [boolean]
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
     include: RegExp; // the files to parse match regex,        default is /\.[tj]sx?$/
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

- [ ] Support HTML and HTML like modules
- [ ] Support CSS and CSS like modules
- [ ] Print interactive SVG

## LICENSE

[MIT](./LICENSE)
