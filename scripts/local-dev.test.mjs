import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint, imageId, runningImage, isRunning } from './local-dev.mjs';

test('fingerprints detect content, additions and deletions while excluding generated dependencies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metor-cache-'));
  try {
    writeFileSync(join(dir, 'source'), 'one');
    const initial = fingerprint([dir]);
    mkdirSync(join(dir, 'node_modules')); writeFileSync(join(dir, 'node_modules', 'dependency'), 'ignored');
    mkdirSync(join(dir, 'dist')); writeFileSync(join(dir, 'dist', 'build'), 'ignored');
    assert.equal(fingerprint([dir]), initial);
    writeFileSync(join(dir, 'source'), 'two'); assert.notEqual(fingerprint([dir]), initial);
    writeFileSync(join(dir, 'source'), 'one'); assert.equal(fingerprint([dir]), initial);
    writeFileSync(join(dir, 'new'), 'new'); assert.notEqual(fingerprint([dir]), initial);
    rmSync(join(dir, 'new')); assert.equal(fingerprint([dir]), initial);
    rmSync(join(dir, 'source')); assert.notEqual(fingerprint([dir]), initial);
  } finally { rmSync(dir, { recursive: true }); }
});
test('running Space identity compares immutable digests for both runtimes', () => {
  for (const rt of ['docker', 'container']) {
    const image = rt === 'docker' ? { Id: 'sha256:new' } : { configuration: { descriptor: { digest: 'sha256:new' } } };
    const space = rt === 'docker' ? { Image: 'sha256:old', State: { Running: true } } : { configuration: { image: { descriptor: { digest: 'sha256:old' } } }, status: { state: 'running' } };
    assert.equal(isRunning(space, rt), true);
    assert.notEqual(imageId(image, rt), runningImage(space, rt));
    assert.equal(isRunning(null, rt), false);
    assert.equal(imageId(null, rt), undefined);
  }
});
