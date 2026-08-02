import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'extension');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

let allValid = true;

const check = (condition, success, failure) => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'} ${condition ? success : failure}`);
  if (!condition) allValid = false;
};

const isValidVersion = (version) => {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version)) return false;
  return version.split('.').every((part) => Number(part) <= 65535);
};

const listFiles = (directory, prefix = '') => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relativePath)
      : [relativePath];
  });
};

const readPngSize = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const isPng = buffer.length >= 24 && buffer.subarray(1, 4).toString('ascii') === 'PNG';
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
};

const getMessageKey = (value) => /^__MSG_([^_].*?)__$/.exec(value || '')?.[1] || '';

console.log('Validating Edge/Chromium extension package');

const requiredFiles = [
  'manifest.json',
  'index.html',
  'assets/popup.js',
  'assets/popup.css',
];

console.log('\nRequired files:');
for (const file of requiredFiles) {
  check(fs.existsSync(path.join(extensionDir, file)), file, `${file} is missing`);
}

let manifest = null;
console.log('\nManifest:');
try {
  manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
  check(manifest.manifest_version === 3, 'Manifest V3', 'manifest_version must be 3');
  check(Boolean(manifest.name?.trim()), `Name: ${manifest.name}`, 'name is required');
  check(Boolean(manifest.description?.trim()), 'Description is present', 'description is required for the store listing');
  check((manifest.description?.length || 0) <= 132, 'Description length is valid', 'description must not exceed 132 characters');
  check(isValidVersion(manifest.version), `Version: ${manifest.version}`, 'version must contain one to four integers from 0 to 65535');
  check(/^\d+\.\d+\.\d+$/.test(manifest.version || ''), 'Version follows the project x.y.z convention', 'project releases must use an x.y.z version');
  check(manifest.version === packageJson.version, 'package.json version matches manifest', `package.json version ${packageJson.version} does not match manifest ${manifest.version}`);
  check(Boolean(manifest.chrome_url_overrides?.newtab), `New tab: ${manifest.chrome_url_overrides?.newtab}`, 'chrome_url_overrides.newtab is required');
  check(!manifest.update_url, 'No external update_url', 'store releases must not define an external update_url');

  const defaultLocale = manifest.default_locale || '';
  const nameMessageKey = getMessageKey(manifest.name);
  const descriptionMessageKey = getMessageKey(manifest.description);
  check(defaultLocale === 'zh_CN', 'Default locale: zh_CN', 'default_locale must be zh_CN for the Simplified Chinese store listing');
  check(Boolean(nameMessageKey), 'Name uses an i18n message', 'name must use a __MSG_*__ localization placeholder');
  check(Boolean(descriptionMessageKey), 'Description uses an i18n message', 'description must use a __MSG_*__ localization placeholder');

  const localeFile = path.join(extensionDir, '_locales', defaultLocale, 'messages.json');
  check(fs.existsSync(localeFile), `_locales/${defaultLocale}/messages.json exists`, `locale messages are missing for ${defaultLocale}`);
  if (fs.existsSync(localeFile)) {
    const messages = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
    const localizedName = messages[nameMessageKey]?.message;
    const localizedDescription = messages[descriptionMessageKey]?.message;
    check(Boolean(localizedName?.trim()), `Localized name: ${localizedName}`, `message ${nameMessageKey} is missing`);
    check(Boolean(localizedDescription?.trim()), 'Localized description is present', `message ${descriptionMessageKey} is missing`);
    check((localizedDescription?.length || 0) <= 132, 'Localized description length is valid', 'localized description must not exceed 132 characters');
  }

  const iconEntries = ['16', '32', '48', '128'].map((size) => [Number(size), manifest.icons?.[size]]).filter(([, iconPath]) => Boolean(iconPath));
  check(iconEntries.length === 4, 'Required icon sizes are declared', 'icons 16, 32, 48, and 128 must be declared');
  for (const [expectedSize, iconPath] of iconEntries) {
    check(fs.existsSync(path.join(extensionDir, iconPath)), `Icon exists: ${iconPath}`, `icon is missing: ${iconPath}`);
    if (fs.existsSync(path.join(extensionDir, iconPath))) {
      const dimensions = readPngSize(path.join(extensionDir, iconPath));
      check(
        dimensions?.width === expectedSize && dimensions?.height === expectedSize,
        `Icon dimensions: ${iconPath} (${expectedSize}x${expectedSize})`,
        `${iconPath} must be a ${expectedSize}x${expectedSize} PNG`,
      );
    }
  }

  const csp = manifest.content_security_policy?.extension_pages || '';
  check(csp.includes("script-src 'self'"), "CSP limits scripts to 'self'", "extension_pages CSP must include script-src 'self'");
  check(!/script-src[^;]*https?:/i.test(csp), 'CSP does not allow remote scripts', 'remote script origins are not allowed');

  const hostPermissions = manifest.host_permissions || [];
  check(hostPermissions.every((permission) => permission.startsWith('https://')), 'Host permissions use HTTPS', 'all host permissions must use HTTPS');
} catch (error) {
  check(false, '', `manifest.json or locale messages are invalid: ${error.message}`);
}

console.log('\nHTML and generated files:');
try {
  const html = fs.readFileSync(path.join(extensionDir, 'index.html'), 'utf8');
  check(html.includes('id="root"'), 'Root element exists', 'index.html must contain id="root"');
  check(!html.includes('src="/assets/') && !html.includes('href="/assets/'), 'Asset paths are relative', 'absolute /assets paths are not valid in the package');
  check(!/<script[^>]+src=["']https?:/i.test(html), 'No remote scripts in HTML', 'remote scripts are not allowed in extension HTML');
} catch (error) {
  check(false, '', `index.html is invalid: ${error.message}`);
}

const generatedFiles = listFiles(extensionDir);
check(!generatedFiles.some((file) => file.endsWith('.map')), 'No source maps in release package', 'source maps must be removed from the release package');
check(!generatedFiles.some((file) => file === '.env' || file.startsWith('.env.')), 'No environment files in release package', 'environment files must not be packaged');

console.log(`\n${allValid ? 'Extension validation passed.' : 'Extension validation failed.'}`);
if (!allValid) process.exit(1);
