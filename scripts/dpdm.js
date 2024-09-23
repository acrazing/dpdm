const fs = require('fs');
const path = require('path');
const os = require('os');

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

const binName = platform === 'win32' ? 'dpdm.exe' : 'dpdm';

const sourceDir = path.join(__dirname, '../target', keyStore[key], 'release');
const sourceFile = path.join(sourceDir, binName);

const targetDir = path.join(__dirname, '../target', 'release');
const targetFile = path.join(targetDir, binName);

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}
fs.copyFile(sourceFile, targetFile, (err) => {
  if (err) {
    console.error('Copy failed:', err);
  }
});

if (platform === 'win32') {
  const packageJson = path.join(__dirname, '../package.json');
  const packageJsonContent = fs.readFileSync(packageJson, 'utf8');
  const packageJsonObj = JSON.parse(packageJsonContent);
  packageJsonObj.bin = binName;
  fs.writeFileSync(
    packageJson,
    JSON.stringify(packageJsonObj, null, 2),
    'utf8',
  );
}
