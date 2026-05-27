#!/usr/bin/env node
/**
 * Free the configured dev port before Vite starts.
 *
 * Vite is set to strictPort, so any leftover process on the port would
 * make `npm run dev` error out. This script finds the holder and kills
 * it. Cross-platform (Windows / macOS / Linux), no dependencies.
 */

import { execSync } from 'node:child_process';

const port = Number(process.argv[2] ?? 5181);
const isWindows = process.platform === 'win32';

function pidsOnPort(p) {
  try {
    if (isWindows) {
      // netstat -ano prints lines like:
      //   TCP  0.0.0.0:5181  0.0.0.0:0  LISTENING  12345
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        // Match :PORT in the local-address column
        if (!new RegExp(`:${p}\\b`).test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    // Empty match exits non-zero on most platforms — treat as "nothing to kill".
    return [];
  }
}

function killPid(pid) {
  try {
    if (isWindows) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.log(`[free-port] port ${port} is clear`);
  process.exit(0);
}

for (const pid of pids) {
  const ok = killPid(pid);
  console.log(`[free-port] ${ok ? 'killed' : 'failed to kill'} pid ${pid} on port ${port}`);
}
