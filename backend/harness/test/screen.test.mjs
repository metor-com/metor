import test from 'node:test';
import assert from 'node:assert/strict';
import { screenSize, resizeScreen } from '../bin/metor-screen.mjs';

test('screen dimensions reject malformed input and limit framebuffer allocation', () => {
  for (const value of [undefined, null, '500', -1, 0, NaN, Infinity, 500.5, 8193]) {
    assert.throws(() => screenSize(value, 800));
    assert.throws(() => screenSize(800, value));
  }
  assert.deepEqual(screenSize(420, 900), { width: 420, height: 900 });
  assert.deepEqual(screenSize(1, 8192), { width: 320, height: 1600 });
  assert.deepEqual(screenSize(8192, 1), { width: 2560, height: 320 });
});
test('display must be a server-selected integer', () => {
  for (const display of [null, '11', -1, 0, 11.5]) assert.throws(() => resizeScreen(display, 500, 900));
});

import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withScreenResizeLock, waitForScreenResize } from '../bin/metor-screen.mjs';
test('busy turns defer and resize errors always release the marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metor-screen-'));
  try {
    assert.deepEqual(withScreenResizeLock(dir, () => false, () => assert.fail('resized busy bot')), { deferred: true });
    assert.throws(() => withScreenResizeLock(dir, () => true, () => { throw Error('resize failed'); }));
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true }); }
});
test('a new turn waits for an in-progress resize', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'metor-screen-'));
  let waiting, entered = false;
  try {
    withScreenResizeLock(dir, () => true, () => {
      assert.ok(existsSync(join(dir, `screen-resize-${process.pid}`)));
      waiting = waitForScreenResize(dir).then(() => { entered = true; });
      assert.equal(entered, false);
    });
    await waiting;
    assert.equal(entered, true);
  } finally { rmSync(dir, { recursive: true }); }
});
