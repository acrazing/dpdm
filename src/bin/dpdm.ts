/*!
 * Copyright 2019 acrazing <joking.young@gmail.com>. All rights reserved.
 * @since 2019-07-17 18:45:32
 */

import yargs from 'yargs';

const argv = yargs
  .usage('$0 [<options>] entry...')
  .option('context', {
    type: 'string',
    desc: 'the context directory to shorten path, default is process.cwd()',
  })
  .option('extensions', {
    alias: 'ext',
    type: 'string',
    desc: 'comma separated extensions to resolve',
    default: '.js,.jsx,.ts,.tsx,.json',
  })
  .option('include', {
    type: 'string',
    desc: 'included filenames regexp in string',
    default: '\\.[tj]sx?$',
  })
  .option('exclude', {
    type: 'string',
    desc: 'excluded filenames regexp in string',
    default: '/node_modules/',
  })
  .option('output', {
    alias: 'o',
    type: 'string',
    desc: 'output json to file',
    default: 'dpdm.json',
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
  .alias('h', 'help')
  .wrap(Math.min(yargs.terminalWidth(), 120)).argv;

if (argv._.length === 0) {
  yargs.showHelp();
  console.log('\nMissing entry file');
  process.exit(1);
}

console.log(argv);
