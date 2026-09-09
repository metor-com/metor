import test from 'node:test';
import assert from 'node:assert/strict';
import { clipboardText, pasteText } from '../bin/metor-clipboard.mjs';
test('clipboard accepts Unicode and multiline text without interpreting it', () => {
  const text = 'Grüße 👋 中文\n$(touch /tmp/not-executed)\n`echo hi`';
  assert.equal(clipboardText(text), text);
  assert.equal(clipboardText(''), '');
});
test('clipboard rejects malformed and oversized values', () => {
  for (const value of [null, undefined, 12, {}, 'a\0b', 'ü'.repeat(131073)]) assert.throws(() => clipboardText(value));
  assert.equal(clipboardText('a'.repeat(262144)).length, 262144);
  for (const display of [null, '11', -1, 0, 11.5]) assert.throws(() => pasteText(display, 'test'));
});
