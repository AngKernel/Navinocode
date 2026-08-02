import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'public', 'manifest.json');
const packagePath = path.join(rootDir, 'package.json');
const extensionDir = path.join(rootDir, 'extension');
const releasesDir = path.join(rootDir, 'releases');

const args = process.argv.slice(2);
const releaseMode = args.includes('--release');
const force = args.includes('--force');
const positional = args.filter((arg) => !arg.startsWith('--'));

const fail = (message) => {
  console.error(`Error: ${message}`);
  process.exit(1);
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const parseVersion = (value) => {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    fail(`invalid release version "${value}"; this project uses three dot-separated integers, for example 1.2.0`);
  }
  const parts = value.split('.').map(Number);
  if (parts.some((part) => part > 65535)) {
    fail(`invalid extension version "${value}"; each integer must be between 0 and 65535`);
  }
  return parts;
};

const compareVersions = (left, right) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};

const bumpVersion = (current, type) => {
  const [major = 0, minor = 0, patch = 0] = parseVersion(current);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  parseVersion(type);
  return type;
};

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with status ${result.status}`);
};

const runNpmScript = (scriptName) => {
  if (process.platform === 'win32') {
    const commandShell = process.env.ComSpec || 'cmd.exe';
    run(commandShell, ['/d', '/s', '/c', `npm.cmd run ${scriptName}`]);
    return;
  }
  run('npm', ['run', scriptName]);
};

const getGitValue = (commandArgs) => {
  const result = spawnSync('git', commandArgs, { cwd: rootDir, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
};

const manifest = readJson(manifestPath);
const packageJson = readJson(packagePath);
const currentVersion = manifest.version;
parseVersion(currentVersion);

let targetVersion = currentVersion;
if (releaseMode) {
  if (positional.length !== 1) {
    fail('release mode requires patch, minor, major, or an explicit version; example: npm run release:edge -- patch');
  }
  targetVersion = bumpVersion(currentVersion, positional[0]);
  if (compareVersions(targetVersion, currentVersion) <= 0) {
    fail(`release version ${targetVersion} must be higher than current version ${currentVersion}`);
  }
} else if (positional.length > 0) {
  fail('package mode does not accept a version; use npm run release:edge -- <version>');
}

const archiveName = `navinocode-edge-v${targetVersion}.zip`;
const archivePath = path.join(releasesDir, archiveName);
if (fs.existsSync(archivePath) && !force) {
  fail(`${path.relative(rootDir, archivePath)} already exists; bump the version or pass --force for a local rebuild`);
}

if (releaseMode) {
  manifest.version = targetVersion;
  packageJson.version = targetVersion;
  writeJson(manifestPath, manifest);
  writeJson(packagePath, packageJson);
  console.log(`Version updated: ${currentVersion} -> ${targetVersion}`);
} else if (packageJson.version !== currentVersion) {
  fail(`package.json version ${packageJson.version} does not match manifest version ${currentVersion}`);
}

runNpmScript('build:extension');
runNpmScript('validate:extension');

fs.mkdirSync(releasesDir, { recursive: true });
if (fs.existsSync(archivePath)) fs.rmSync(archivePath);

const extensionEntries = fs.readdirSync(extensionDir).sort();
if (!extensionEntries.includes('manifest.json')) fail('extension/manifest.json is missing');

if (process.platform === 'win32') {
  const quote = (value) => value.replaceAll("'", "''");
  const command = `Compress-Archive -Path '${quote(path.join(extensionDir, '*'))}' -DestinationPath '${quote(archivePath)}' -CompressionLevel Optimal`;
  run('powershell.exe', ['-NoProfile', '-Command', command]);
} else {
  run('zip', ['-r', '-q', '-9', archivePath, ...extensionEntries], { cwd: extensionDir });
}

const archive = fs.readFileSync(archivePath);
if (archive.length === 0) fail('generated package is empty');
const sha256 = createHash('sha256').update(archive).digest('hex');
const commit = getGitValue(['rev-parse', '--short', 'HEAD']);
const workingTree = getGitValue(['status', '--porcelain']);
const metadata = {
  name: manifest.name,
  version: targetVersion,
  manifestVersion: manifest.manifest_version,
  package: archiveName,
  size: archive.length,
  sha256,
  builtAt: new Date().toISOString(),
  gitCommit: commit,
  gitDirty: workingTree === null ? null : workingTree.length > 0,
  permissions: manifest.permissions || [],
  hostPermissions: manifest.host_permissions || [],
};

const metadataPath = path.join(releasesDir, `navinocode-edge-v${targetVersion}.json`);
const checksumPath = path.join(releasesDir, `navinocode-edge-v${targetVersion}.sha256`);
writeJson(metadataPath, metadata);
fs.writeFileSync(checksumPath, `${sha256}  ${archiveName}\n`);

console.log(`Edge package: ${path.relative(rootDir, archivePath)}`);
console.log(`SHA-256: ${sha256}`);
console.log(`Metadata: ${path.relative(rootDir, metadataPath)}`);
