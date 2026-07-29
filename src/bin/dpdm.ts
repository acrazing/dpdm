#!/usr/bin/env node
/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import ora from 'ora';
import path from 'path';
import yargs from 'yargs';
import { loadConfig } from '../config';
import { parseDependencyTree } from '../parser';
import { Config, ParseOptions } from '../types';
import {
  defaultOptions,
  globFiles,
  groupCircularsByPackage,
  groupDependencyTreeByPackage,
  groupEntriesByPackage,
  isEmpty,
  parseCircular,
  parseWarnings,
  prettyCircular,
  prettyTree,
  prettyWarning,
  simpleResolver,
  uniqueCirculars,
} from '../utils';
import type { SkippedImport } from '../utils';
import { hideBin } from 'yargs/helpers';

function splitSkipImportValue(value: string): string[] {
  return value.split(',').filter(Boolean);
}

function normalizeCircularId(context: string, id: string) {
  const fullPath = path.isAbsolute(id) ? id : path.resolve(context, id);
  return path.relative(context, fullPath);
}

function resolveFromCwd(cwd: string, target: string): string {
  return path.resolve(cwd, target);
}

function parseSkipImports(
  skipImports: string[],
  context: string,
): SkippedImport[] {
  return skipImports.map((item) => {
    const parts = item.split(':');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new TypeError(
        `skip import should be in the format ISSUER:DEPENDENCY`,
      );
    }
    return [
      normalizeCircularId(context, parts[0]),
      normalizeCircularId(context, parts[1]),
    ];
  });
}

function firstDefined<T>(...values: (T | undefined)[]): T {
  for (const value of values) {
    if (value !== void 0) {
      return value;
    }
  }
  return values[values.length - 1] as T;
}

function stringArray(value: string | string[] | undefined): string[] {
  if (value === void 0) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function commaSeparatedList(
  value: string | string[] | undefined,
  fallback: string[],
): string[] {
  if (value === void 0) {
    return fallback.slice();
  }
  return (Array.isArray(value) ? value : value.split(',')).filter(Boolean);
}

function parseInclude(value: string | RegExp | undefined): RegExp {
  if (value instanceof RegExp) {
    return value;
  }
  return new RegExp(value || defaultOptions.include.source);
}

function parseExclude(value: string | RegExp | undefined): RegExp {
  if (value instanceof RegExp) {
    return value;
  }
  return new RegExp(value || '$.');
}

async function main() {
  const y = yargs(hideBin(process.argv));
  const argv = await y
    .strict()
    .usage('$0 [files...]', "Analyze the files' dependencies.", (yargs) => {
      return yargs.positional('files', {
        description: 'The file paths or globs',
        type: 'string',
        array: true,
      });
    })
    .option('config', {
      type: 'string',
      desc: 'the config file path, default searches dpdm.config.* in cwd',
    })
    .option('context', {
      type: 'string',
      desc: 'the context directory to shorten path, default is cwd',
    })
    .option('cwd', {
      type: 'string',
      desc: 'the working directory used to match files and resolve relative paths, default is current directory',
    })
    .option('extensions', {
      alias: 'ext',
      type: 'string',
      desc: 'comma separated extensions to resolve',
    })
    .option('js', {
      type: 'string',
      desc: 'comma separated extensions indicate the file is js like',
    })
    .option('include', {
      type: 'string',
      desc: 'included filenames regexp in string, default includes all files',
    })
    .option('exclude', {
      type: 'string',
      desc: 'excluded filenames regexp in string, set as empty string to include all files',
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      desc: 'output json to file',
    })
    .option('tree', {
      type: 'boolean',
      desc: 'print tree to stdout',
    })
    .option('circular', {
      type: 'boolean',
      desc: 'print circular to stdout',
    })
    .option('warning', {
      type: 'boolean',
      desc: 'print warning to stdout',
    })
    .option('tsconfig', {
      type: 'string',
      desc: 'the tsconfig path, which is used for resolve path alias, default is tsconfig.json if it exists in context directory',
    })
    .option('transform', {
      type: 'boolean',
      desc: 'transform typescript modules to javascript before analyze, it allows you to omit types dependency in typescript',
      alias: 'T',
    })
    .option('exit-code', {
      type: 'string',
      desc:
        'exit with specified code, the value format is CASE:CODE, `circular` is the only supported CASE, ' +
        'CODE should be a integer between 0 and 128. ' +
        'For example: `dpdm --exit-code circular:1` the program will exit with code 1 if circular dependency found.',
    })
    .option('progress', {
      type: 'boolean',
      desc: 'show progress bar',
    })
    .option('detect-unused-files-from', {
      type: 'string',
      desc: 'this file is a glob, used for finding unused files.',
    })
    .option('skip-dynamic-imports', {
      type: 'string',
      choices: ['tree', 'circular'],
      desc: 'Skip parse import(...) statement.',
    })
    .option('skip-imports', {
      type: 'string',
      array: true,
      desc: 'Skip import edges from circular checks. Values are regexp ISSUER:DEPENDENCY pairs.',
    })
    .option('ignore-miss-warning', {
      type: 'string',
      array: true,
      nargs: 1,
      desc: 'ignore miss warnings whose import request matches any specified regexp',
    })
    .option('ignore-skip-warning', {
      type: 'string',
      array: true,
      nargs: 1,
      desc: 'ignore skip warnings whose skipped file matches any specified regexp',
    })
    .option('group-by-package', {
      type: 'boolean',
      desc: 'print dependencies and circulars grouped by nearest package.json',
    })
    .alias('h', 'help')
    .wrap(Math.min(y.terminalWidth(), 100))
    .parseAsync();

  const configSearchCwd = path.resolve(
    (argv.cwd as string | undefined) || process.cwd(),
  );
  const config = (await loadConfig(
    configSearchCwd,
    argv.config as string | undefined,
  )) as Config;
  const positionalFiles = (argv._ as Array<string | number>).map(String);
  const namedFiles = stringArray(argv.files as string[] | undefined);
  const filesFromArgv = namedFiles.length > 0 ? namedFiles : positionalFiles;
  const files =
    filesFromArgv.length > 0 ? filesFromArgv : stringArray(config.files);

  if (files.length === 0) {
    y.showHelp();
    console.log('\nMissing entry file');
    process.exit(1);
  }

  const exitCases = new Set(['circular']);
  const exitCodes: [string, number][] = [];
  const exitCode = firstDefined(
    argv['exit-code'] as string | undefined,
    config.exitCode,
    '',
  );
  if (exitCode) {
    exitCode.split(',').forEach((c) => {
      const [label, code] = c.split(':');
      if (!code || !isFinite(+code)) {
        throw new TypeError(`exit code should be a number`);
      }
      if (!exitCases.has(label)) {
        throw new TypeError(`unsupported exit case "${label}"`);
      }
      exitCodes.push([label, +code]);
    });
  }

  const o = ora('Start analyzing dependencies...').start();

  let total = 0;
  let ended = 0;
  let current = '';

  const cwd = path.resolve(
    (argv.cwd as string | undefined) || config.cwd || process.cwd(),
  );
  const context = path.resolve(
    cwd,
    (argv.context as string | undefined) || config.context || '.',
  );
  const progress = firstDefined(
    argv.progress as boolean | undefined,
    config.progress,
    process.stdout.isTTY && !process.env.CI,
  );
  const skipDynamicImports = firstDefined(
    argv.skipDynamicImports as 'tree' | 'circular' | undefined,
    config.skipDynamicImports,
    undefined,
  );
  const groupByPackage = firstDefined(
    argv.groupByPackage as boolean | undefined,
    config.groupByPackage,
    false,
  );
  const showTree = firstDefined(
    argv.tree as boolean | undefined,
    config.tree,
    true,
  );
  const showCircular = firstDefined(
    argv.circular as boolean | undefined,
    config.circular,
    true,
  );
  const showWarning = firstDefined(
    argv.warning as boolean | undefined,
    config.warning,
    true,
  );
  const skipImports = firstDefined(
    argv.skipImports as string[] | undefined,
    stringArray(config.skipImports),
    [],
  );
  const ignoreMissWarning = firstDefined(
    argv.ignoreMissWarning as string[] | undefined,
    stringArray(config.ignoreMissWarning || config.ignoreMissWarnings),
    [],
  );
  const ignoreSkipWarning = firstDefined(
    argv.ignoreSkipWarning as string[] | undefined,
    stringArray(config.ignoreSkipWarning || config.ignoreSkipWarnings),
    [],
  );
  const output = firstDefined(
    argv.output as string | undefined,
    config.output,
    undefined,
  );
  const detectUnusedFilesFrom = firstDefined(
    argv.detectUnusedFilesFrom as string | undefined,
    config.detectUnusedFilesFrom,
    undefined,
  );
  const skippedImports = parseSkipImports(
    skipImports.flatMap(splitSkipImportValue),
    context,
  );

  function onProgress(event: 'start' | 'end', target: string) {
    switch (event) {
      case 'start':
        total += 1;
        current = path.relative(context, target);
        break;
      case 'end':
        ended += 1;
        break;
    }
    if (progress) {
      o.text = `[${ended}/${total}] Analyzing ${current}...`;
      o.render();
    }
  }

  const options: ParseOptions = {
    cwd,
    context,
    extensions: commaSeparatedList(
      firstDefined(
        argv.extensions as string | undefined,
        config.extensions,
        undefined,
      ),
      defaultOptions.extensions.filter(Boolean),
    ),
    js: commaSeparatedList(
      firstDefined(argv.js as string | undefined, config.js, undefined),
      defaultOptions.js,
    ),
    include: parseInclude(
      firstDefined(
        argv.include as string | undefined,
        config.include,
        defaultOptions.include,
      ),
    ),
    exclude: parseExclude(
      firstDefined(
        argv.exclude as string | undefined,
        config.exclude,
        defaultOptions.exclude,
      ),
    ),
    tsconfig: firstDefined(
      argv.tsconfig as string | undefined,
      config.tsconfig,
      undefined,
    ),
    transform: firstDefined(
      argv.transform as boolean | undefined,
      config.transform,
      defaultOptions.transform,
    ),
    skipDynamicImports: skipDynamicImports === 'tree',
    onProgress,
  };

  parseDependencyTree(files, options)
    .then(async (tree) => {
      if (isEmpty(tree)) {
        throw new Error(`No entry files were matched.`);
      }
      o.succeed(`[${ended}/${total}] Analyze done!`);
      const entriesDeep = await Promise.all(
        files.map((g) => globFiles(g, cwd)),
      );
      const entries = await Promise.all(
        Array<string>()
          .concat(...entriesDeep)
          .map((name) => {
            const fullName = resolveFromCwd(cwd, name);
            return simpleResolver(cwd, fullName, options.extensions).then(
              (id) => path.relative(context, id || fullName),
            );
          }),
      );
      const displayedTree = groupByPackage
        ? groupDependencyTreeByPackage(tree, context)
        : tree;
      const displayedEntries = groupByPackage
        ? groupEntriesByPackage(entries, context)
        : entries;
      const circulars = groupByPackage
        ? uniqueCirculars([
            ...parseCircular(
              displayedTree,
              skipDynamicImports === 'circular',
              skippedImports,
            ),
            ...groupCircularsByPackage(
              parseCircular(
                tree,
                skipDynamicImports === 'circular',
                skippedImports,
              ),
              context,
            ),
          ])
        : parseCircular(
            displayedTree,
            skipDynamicImports === 'circular',
            skippedImports,
          );
      if (output) {
        await fs.outputJSON(
          output,
          { entries: displayedEntries, tree: displayedTree, circulars },
          { spaces: 2 },
        );
      }
      if (showTree) {
        console.log(
          chalk.bold(
            groupByPackage
              ? '• Package Dependencies Tree'
              : '• Dependencies Tree',
          ),
        );
        console.log(prettyTree(displayedTree, displayedEntries));
        console.log('');
      }
      if (showCircular) {
        console.log(
          chalk.bold[circulars.length === 0 ? 'green' : 'red'](
            groupByPackage
              ? '• Package Circular Dependencies'
              : '• Circular Dependencies',
          ),
        );
        if (circulars.length === 0) {
          console.log(
            chalk.bold.green(
              '  ✅ Congratulations, no circular dependency was found in your project.',
            ),
          );
        } else {
          console.log(prettyCircular(circulars));
        }
        console.log('');
      }
      if (showWarning) {
        console.log(chalk.bold.yellow('• Warnings'));
        console.log(
          prettyWarning(
            parseWarnings(tree, undefined, {
              ignoreMissWarnings: ignoreMissWarning.map(
                (item) => new RegExp(item),
              ),
              ignoreSkipWarnings: ignoreSkipWarning.map(
                (item) => new RegExp(item),
              ),
            }),
          ),
        );
        console.log('');
      }
      if (detectUnusedFilesFrom) {
        const allFiles = await globFiles(detectUnusedFilesFrom, cwd);
        const shortAllFiles = allFiles.map((v) =>
          path.relative(context, resolveFromCwd(cwd, v)),
        );
        const unusedFiles = shortAllFiles.filter((v) => !(v in tree)).sort();
        console.log(chalk.bold.cyan('• Unused files'));
        if (unusedFiles.length === 0) {
          console.log(
            chalk.bold.green(
              '  ✅ Congratulations, no unused file was found in your project. (total: ' +
                allFiles.length +
                ', used: ' +
                Object.keys(tree).length +
                ')',
            ),
          );
        } else {
          const len = unusedFiles.length.toString().length;
          unusedFiles.forEach((f, i) => {
            console.log('%s) %s', i.toString().padStart(len, '0'), f);
          });
        }
      }
      for (const [label, code] of exitCodes) {
        switch (label) {
          case 'circular':
            if (circulars.length > 0) {
              process.exit(code);
            }
        }
      }
    })
    .catch((e: Error) => {
      o.fail();
      console.error(e.stack || e);
      process.exit(1);
    });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
