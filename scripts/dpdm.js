const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const platform = os.platform();
const arch = os.arch();

const key = `${platform}-${arch}`;

const keyStore = {
  'darwin-arm64': 'aarch64-apple-darwin',
  // 'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-gnu',
  'win32-arm64': 'aarch64-pc-windows-gnu',
};

const sourceDir = path.join(__dirname, '../target', keyStore[key], 'release');
const binFile = path.join(
  sourceDir,
  platform === 'win32' ? 'dpdm.exe' : 'dpdm',
);

const args = process.argv.slice(2);

const child = spawn(binFile, args, { stdio: 'inherit' });

child.on('close', (code) => {
  process.exit(code);
});

child.on('error', (error) => {
  console.error(`Failed to execute ${binFile}: ${error.message}`);
  process.exit(1);
});
