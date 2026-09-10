// Isolated Space; creates diagnostic records without sending inference requests.
import { chromium } from '/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { event } from '/usr/local/lib/metor/metor-events.mjs';
import assert from 'node:assert/strict';
const name = 'events-probe', dir = `/workspace/bots/${name}/.metor`;
execFileSync('metor', ['bot', 'create', name, '--harness', 'codex']);
for (let i = 0; i < 105; i++) event(dir, 'runtime.sleeping');
for (const type of ['routine.queued', 'runtime.waking', 'turn.started', 'turn.failed']) event(dir, type, { runId: 'test-run', routineId: 'test-routine', turnId: 'test-message', reason: 'test_failure' });
assert.equal((await fetch(`http://127.0.0.1:6010/bots/api/agents/${name}/events`)).status, 401);
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const link = execFileSync('metor', ['auth', 'link', '--plain'], { encoding: 'utf8' }).match(/http[^\s]+claim\?token=[A-Za-z0-9_-]+/)[0];
  await page.goto(link); await page.goto(`http://127.0.0.1:6010/bots/#/${name}`);
  await page.getByRole('button', {name: 'More actions'}).click();
  await page.getByRole('button', {name: 'Event log', exact: true}).click();
  await page.getByText('Processing failed', {exact:true}).waitFor();
  assert.equal(await page.locator('article').count(), 100);
  await page.getByRole('button', {name:'Show more'}).click();
  assert.ok(await page.locator('article').count() > 100);
  await page.getByLabel('Filter events').selectOption('errors');
  assert.equal(await page.locator('article').count(), 1);
  await page.getByRole('button', {name:'Run: test-run',exact:true}).click();
  assert.equal(await page.locator('article').count(), 4);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export',exact:true}).click();
  const download = await downloading;
  const rows = readFileSync(await download.path(), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 4); assert.ok(rows.every(e => e.runId === 'test-run'));
  await page.screenshot({path:'/tmp/metor-events-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(100);
  if (!await page.getByRole('heading', {name:'Event log',exact:true}).isVisible()) {
    await page.getByRole('button', {name:'More actions'}).click();
    await page.getByRole('button', {name:'Event log',exact:true}).click();
  }
  await page.getByText('Processing failed', {exact:true}).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.waitForTimeout(500);
  await page.screenshot({path:'/tmp/metor-events-mobile.png'});
  assert.equal(JSON.parse(readFileSync(`${dir}/harness.json`)).runtimeLoaded, false);
  assert.deepEqual(errors, []);
  console.log('PASS: authenticated log, no wake on read, filters, run correlation, pagination, export and mobile layout');
} finally { await browser.close(); execFileSync('metor',['bot','rm',name]); }
