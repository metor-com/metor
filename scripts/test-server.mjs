#!/usr/bin/env node
// End-to-end server tests on macOS, isolated from the active runtime and all user Spaces.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repo);
const profile = `metor-test-${Date.now().toString(36)}`;
const command = (file, args, options = {}) => execFileSync(file, args, { stdio: 'inherit', timeout: 20 * 60 * 1000, ...options });
const remote = (...args) => command('colima', ['-p', profile, 'ssh', '--', ...args]);
command('colima', ['version']);
let created = false;
try {
  console.log(`Creating disposable Ubuntu/Docker VM ${profile} (2 CPUs, 4 GiB RAM, 40 GiB disk)…`);
  created = true;
  command('colima', ['start', profile, '--activate=false', '--ssh-config=false', '--cpus', '2', '--memory', '4', '--disk', '40', '--mount', 'none', '--port-forwarder', 'none']);
  remote('sudo', 'sh', '-c', 'apt-get update -qq && apt-get install -y -qq nodejs curl iproute2');
  remote('sudo', 'mkdir', '-p', '/test/scripts', '/test/deploy');
  for (const path of ['scripts/server-recovery.integration.mjs', 'deploy/install.sh']) {
    command('colima', ['-p', profile, 'ssh', '--', 'sudo', 'tee', `/test/${path}`], { input: readFileSync(path), stdio: ['pipe', 'ignore', 'inherit'] });
  }
  remote('sudo', 'docker', 'pull', 'ghcr.io/metor-com/metor-box:0.4.0');
  console.log('Running real installer recovery and Caddy TLS checks…');
  remote('sudo', 'sh', '-c', 'cd /test && METOR_DISPOSABLE_DOCKER=yes node scripts/server-recovery.integration.mjs');
  console.log('Running real SSH management and release upgrade checks…');
  command(process.execPath, ['scripts/server-management.integration.mjs'], { env: { ...process.env, METOR_DISPOSABLE_COLIMA: profile } });
} finally {
  if (created) {
    console.log(`Removing disposable VM ${profile} and its test data…`);
    command('colima', ['delete', profile, '--force', '--data']);
  }
}
