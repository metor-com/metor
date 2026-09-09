import test from 'node:test';
import assert from 'node:assert/strict';
import { clipboardText, pasteText, copyText, readClipboard } from '../bin/metor-clipboard.mjs';
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

test('copy reads the selected text and rejects unavailable or oversized selections', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'metor-copy-'));
  const previous = process.env.PATH;
  try {
    process.env.PATH = `${dir}:${previous}`;
    const stub = (body) => writeFileSync(join(dir, 'xclip'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    stub('[ "$DISPLAY" = :11 ] && [ "$1 $2 $3" = "-selection primary -out" ] || exit 1\nprintf "Grüße 👋\\n中文"');
    assert.deepEqual(copyText(11), { text: 'Grüße 👋\n中文' });
    stub('[ "$DISPLAY" = :11 ] && [ "$1 $2 $3" = "-selection clipboard -out" ] || exit 1\nprintf "Actually copied"');
    assert.deepEqual(readClipboard(11), { text: 'Actually copied' });
    stub('exit 1');
    assert.deepEqual(readClipboard(11), { text: null });
    assert.throws(() => copyText(11), /Select plain text/);
    stub('head -c 262145 /dev/zero');
    assert.throws(() => copyText(11));
    for (const display of [null, '11', -1, 0, 11.5]) assert.throws(() => copyText(display));
  } finally { process.env.PATH = previous; rmSync(dir, { recursive: true, force: true }); }
});
