#!/usr/bin/env node
/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import chalk from 'chalk';
import fs from 'fs-extra';
import * as G from 'glob';
import ora from 'ora';
import path from 'path';
import yargs from 'yargs';
import { parseDependencyTree } from '../parser';
import { ParseOptions } from '../types';
import {
  defaultOptions,
  groupDependencyTreeByPackage,
  groupEntriesByPackage,
  isEmpty,
  parseCircular,
  parseWarnings,
  prettyCircular,
  prettyTree,
  prettyWarning,
  simpleResolver,
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

async function main() {
  const y = yargs(hideBin(process.argv));
  const argv = await y
    .strict()
    .usage(
      '$0 [options] <files...>',
      "Analyze the files' dependencies.",
      (yargs) => {
        return yargs.positional('files', {
          description: 'The file paths or globs',
          demandOption: true,
          type: 'string',
          array: true,
        });
      },
    )
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
      default: defaultOptions.extensions.filter(Boolean).join(','),
    })
    .option('js', {
      type: 'string',
      desc: 'comma separated extensions indicate the file is js like',
      default: defaultOptions.js.join(','),
    })
    .option('include', {
      type: 'string',
      desc: 'included filenames regexp in string, default includes all files',
      default: defaultOptions.include.source,
    })
    .option('exclude', {
      type: 'string',
      desc: 'excluded filenames regexp in string, set as empty string to include all files',
      default: defaultOptions.exclude.source,
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      desc: 'output json to file',
    })
    .option('tree', {
      type: 'boolean',
      desc: 'print tree to stdout',
      default: true,
    })
    .option('circular', {
      type: 'boolean',
      desc: 'print circular to stdout',
      default: true,
    })
    .option('warning', {
      type: 'boolean',
      desc: 'print warning to stdout',
      default: true,
    })
    .option('tsconfig', {
      type: 'string',
      desc: 'the tsconfig path, which is used for resolve path alias, default is tsconfig.json if it exists in context directory',
    })
    .option('transform', {
      type: 'boolean',
      desc: 'transform typescript modules to javascript before analyze, it allows you to omit types dependency in typescript',
      default: defaultOptions.transform,
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
      default: process.stdout.isTTY && !process.env.CI,
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
    .option('group-by-package', {
      type: 'boolean',
      desc: 'print dependencies and circulars grouped by nearest package.json',
      default: false,
    })
    .alias('h', 'help')
    .wrap(Math.min(y.terminalWidth(), 100))
    .parseAsync();

  const files = argv.files as string[];

  if (files.length === 0) {
    yargs.showHelp();
    console.log('\nMissing entry file');
    process.exit(1);
  }

  const exitCases = new Set(['circular']);
  const exitCodes: [string, number][] = [];
  if (argv['exit-code']) {
    argv['exit-code'].split(',').forEach((c) => {
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

  const cwd = path.resolve((argv.cwd as string | undefined) || process.cwd());
  const context = path.resolve(cwd, argv.context || '.');
  const skippedImports = parseSkipImports(
    ((argv.skipImports as string[] | undefined) || []).flatMap(
      splitSkipImportValue,
    ),
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
    if (argv.progress) {
      o.text = `[${ended}/${total}] Analyzing ${current}...`;
      o.render();
    }
  }

  const options: ParseOptions = {
    cwd,
    context,
    extensions: argv.extensions.split(','),
    js: argv.js.split(','),
    include: new RegExp(argv.include || '.*'),
    exclude: new RegExp(argv.exclude || '$.'),
    tsconfig: argv.tsconfig,
    transform: argv.transform,
    skipDynamicImports: argv.skipDynamicImports === 'tree',
    onProgress,
  };

  parseDependencyTree(files, options)
    .then(async (tree) => {
      if (isEmpty(tree)) {
        throw new Error(`No entry files were matched.`);
      }
      o.succeed(`[${ended}/${total}] Analyze done!`);
      const entriesDeep = await Promise.all(
        files.map((g) => G.glob(g, { cwd })),
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
      const displayedTree = argv.groupByPackage
        ? groupDependencyTreeByPackage(tree, context)
        : tree;
      const displayedEntries = argv.groupByPackage
        ? groupEntriesByPackage(entries, context)
        : entries;
      const circulars = parseCircular(
        displayedTree,
        argv.skipDynamicImports === 'circular',
        skippedImports,
      );
      if (argv.output) {
        await fs.outputJSON(
          argv.output,
          { entries: displayedEntries, tree: displayedTree, circulars },
          { spaces: 2 },
        );
      }
      if (argv.tree) {
        console.log(
          chalk.bold(
            argv.groupByPackage
              ? '• Package Dependencies Tree'
              : '• Dependencies Tree',
          ),
        );
        console.log(prettyTree(displayedTree, displayedEntries));
        console.log('');
      }
      if (argv.circular) {
        console.log(
          chalk.bold[circulars.length === 0 ? 'green' : 'red'](
            argv.groupByPackage
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
      if (argv.warning) {
        console.log(chalk.bold.yellow('• Warnings'));
        console.log(prettyWarning(parseWarnings(tree)));
        console.log('');
      }
      if (argv.detectUnusedFilesFrom) {
        const allFiles = await G.glob(argv.detectUnusedFilesFrom, { cwd });
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
