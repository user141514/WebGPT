import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = join(root, 'extension');

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      if (rel === 'extension/dist' || rel === 'node_modules' || rel.startsWith('node_modules/')) continue;
      await walk(full, files);
      continue;
    }
    if (rel === 'extension/build.json') continue;
    files.push(full);
  }
  return files;
}

async function sourceFiles() {
  const files = [];
  for (const dir of ['src', 'client', 'extension']) {
    await walk(join(root, dir), files);
  }
  for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) {
    files.push(join(root, file));
  }
  return [...new Set(files)].sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
}

async function computeBuildId() {
  const hash = createHash('sha256');
  for (const file of await sourceFiles()) {
    const rel = relative(root, file).replaceAll('\\', '/');
    hash.update(rel);
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 24);
}

const manifest = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
const buildId = await computeBuildId();

const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [tsc], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
if (result.status !== 0) process.exit(result.status ?? 1);

const buildInfo = {
  buildId,
  builtAt: new Date().toISOString(),
  version: String(manifest.version ?? '')
};
await writeFile(join(extensionRoot, 'build.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(buildInfo));
