#!/usr/bin/env node
/**
 * Sync a single version across the entire monorepo.
 *
 * Usage:
 *   node scripts/sync-versions.mjs 0.2.0
 *
 * This updates the `version` field in the root workspace package.json and every
 * workspace package.json, and also bumps any internal `@tramo/*` or `tramo`
 * dependency to the same version so cross-package references stay consistent.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(newVersion)) {
  console.error('Usage: node scripts/sync-versions.mjs <semver>');
  process.exit(1);
}

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const workspaceGlobs = rootPkg.workspaces ?? [];

const packagePaths = ['package.json'];
for (const glob of workspaceGlobs) {
  if (glob.endsWith('/*')) {
    const base = glob.slice(0, -2);
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const pkgPath = join(dir, entry, 'package.json');
      if (existsSync(pkgPath)) packagePaths.push(pkgPath);
    }
  } else {
    const pkgPath = join(ROOT, glob, 'package.json');
    if (existsSync(pkgPath)) packagePaths.push(pkgPath);
  }
}

// Sort so root comes first, then deterministic order.
packagePaths.sort();

const internalScopes = ['@tramo/'];
const internalNames = ['tramo'];

function isInternalDep(name) {
  return internalScopes.some((scope) => name.startsWith(scope)) || internalNames.includes(name);
}

for (const pkgPath of packagePaths) {
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);

  // Don't version the private root workspace.
  if (pkgPath === 'package.json') {
    // Still bump workspace root dependencies if they point internally.
  } else {
    pkg.version = newVersion;
  }

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      if (isInternalDep(name)) {
        deps[name] = newVersion;
      }
    }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✓ ${pkgPath} → ${pkgPath === 'package.json' ? '(workspace root)' : newVersion}`);
}

console.log(`\nAll packages synced to ${newVersion}.`);
