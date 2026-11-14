const { mkdirSync, writeFileSync } = require('node:fs');

mkdirSync('lib/esm', { recursive: true });
writeFileSync('lib/esm/package.json', '{"type":"module"}\n');
writeFileSync('lib/index.mjs', "export * from './esm/index.js';\n");
