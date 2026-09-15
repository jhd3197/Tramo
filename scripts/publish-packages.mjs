#!/usr/bin/env node
/**
 * Publish every tramo package to npm in dependency order.
 *
 * Usage:
 *   # First-time publish at current version (0.1.0)
 *   node scripts/publish-packages.mjs
 *
 *   # Bump to a new version, sync deps, then publish
 *   node scripts/publish-packages.mjs 0.2.0
 *
 * Environment:
 *   NPM_TOKEN or NODE_AUTH_TOKEN — npm access token with publish permission.
 *
 * The script publishes:
 *   1. @tramo/spec
 *   2. @tramo/runtime
 *   3. @tramo/editor
 *   4. @tramo/cli
 *   5. every @tramo/<brand> integration pack
 *   6. the umbrella `tramo` package
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const tagIndex = args.findIndex((a) => a === '--tag');
const distTag = tagIndex !== -1 ? args[tagIndex + 1] : undefined;
const newVersion = args.find((a) => !a.startsWith('--') && a !== distTag);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Publish every tramo package to npm in dependency order.

Usage:
  node scripts/publish-packages.mjs [version] [--skip-build] [--tag <dist-tag>]

Examples:
  # First-time publish at current version (0.1.0)
  node scripts/publish-packages.mjs

  # Bump to a new version, sync deps, build, then publish
  node scripts/publish-packages.mjs 0.2.0

  # CI: version already synced and build already ran
  node scripts/publish-packages.mjs --skip-build

  # CI dev channel
  node scripts/publish-packages.mjs --skip-build --tag dev

Environment:
  NPM_TOKEN or NODE_AUTH_TOKEN — npm access token with publish permission.`);
  process.exit(0);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
  return result;
}

const VERSIONS = new Map();

/** Record a workspace package's name and the version this checkout would publish. */
function record(pkgPath, names) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  names.push(pkg.name);
  VERSIONS.set(pkg.name, pkg.version);
}

/** True when this exact version is already on the registry.
 *
 * A release can stop partway: a network failure, an expired token, or a
 * one-time password that timed out. Re-running must finish the release rather
 * than abort on the first package that already went out. */
function alreadyPublished(name, version) {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return result.status === 0 && String(result.stdout).trim().includes(version);
}

function getWorkspaceNames() {
  const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const names = [];
  for (const glob of rootPkg.workspaces ?? []) {
    if (glob.endsWith('/*')) {
      const base = glob.slice(0, -2);
      const dir = join(ROOT, base);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir)) {
        const pkgPath = join(dir, entry, 'package.json');
        if (existsSync(pkgPath)) {
          record(pkgPath, names);
        }
      }
    } else {
      const pkgPath = join(ROOT, glob, 'package.json');
      if (existsSync(pkgPath)) {
        record(pkgPath, names);
      }
    }
  }
  return names;
}

function determinePublishOrder(names) {
  const order = [
    '@tramo/spec',
    '@tramo/runtime',
    '@tramo/editor',
    '@tramo/cli',
  ];

  // Integration packs only depend on spec/runtime, so any order works.
  const integrations = names
    .filter((n) => n.startsWith('@tramo/') && !order.includes(n))
    .sort();
  order.push(...integrations);

  // Umbrella comes last because it depends on everything.
  if (names.includes('tramo')) order.push('tramo');

  return order;
}

const isCI = process.env.CI === 'true';
const token = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN;
if (!token) {
  console.error('Error: set NPM_TOKEN or NODE_AUTH_TOKEN before publishing.');
  process.exit(1);
}

// Ensure the token is available as NODE_AUTH_TOKEN for npm publish.
process.env.NODE_AUTH_TOKEN = token;

// Also write a temporary .npmrc so npm definitely picks up the token on Windows.
// .npmrc is gitignored, so it won't be committed.
import { writeFileSync, unlinkSync } from 'node:fs';
const npmrcPath = join(ROOT, '.npmrc');
writeFileSync(npmrcPath, `//registry.npmjs.org/:_authToken=${token}\n`, 'utf8');

function cleanup() {
  try {
    unlinkSync(npmrcPath);
  } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

if (newVersion) {
  console.log(`\n📦 Syncing monorepo to ${newVersion}...\n`);
  run('node', [join('scripts', 'sync-versions.mjs'), newVersion]);
}

if (!skipBuild) {
  console.log('\n🔨 Building all packages...\n');
  run('npm', ['run', 'build']);
} else {
  console.log('\n⏭️ Skipping build (--skip-build).\n');
}

const names = getWorkspaceNames().filter((n) => n !== 'tramo-workspace' && n !== 'tramo-demo');
const publishOrder = determinePublishOrder(names);

console.log('\n🚀 Publishing in order:\n');
const skipped = [];
const published = [];
for (const name of publishOrder) {
  const version = VERSIONS.get(name);
  if (version && alreadyPublished(name, version)) {
    console.log(`\n⏭️  ${name}@${version} is already on the registry — skipping.\n`);
    skipped.push(`${name}@${version}`);
    continue;
  }
  console.log(`\n📤 Publishing ${name}@${version}...\n`);
  const publishArgs = ['publish', '-w', name, '--access', 'public'];
  if (isCI) publishArgs.push('--provenance');
  if (distTag) publishArgs.push('--tag', distTag);
  run('npm', publishArgs);
  published.push(`${name}@${version}`);
}

console.log(`\n✅ Release complete: ${published.length} published, ${skipped.length} already on the registry.`);
if (published.length) console.log(`   published: ${published.join(', ')}`);
if (skipped.length) console.log(`   skipped:   ${skipped.join(', ')}`);
