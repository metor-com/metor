// Run inside an isolated test Space with a running smoke bot; prompt submission is intercepted.
import { chromium } from '/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.stack));
  const link = execFileSync('metor', ['auth', 'link', '--plain'], { encoding: 'utf8' }).match(/http[^\s]+claim\?token=[A-Za-z0-9_-]+/)[0];
  const commands = [
    { id: 'harness:model', name: 'model', origin: 'harness', action: 'model', description: 'Choose the model for subsequent messages' },
    { id: 'harness:stop', name: 'stop', origin: 'harness', action: 'prompt', description: 'Runtime stop command' },
    { id: 'harness:review', name: 'review', origin: 'harness', action: 'prompt', description: 'Review changes' },
  ];
  await page.route('**/chat/commands', (route) => route.fulfill({ json: { commands, models: [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta', reasoningEfforts: [{ id: 'low', label: 'low', description: 'Faster' }, { id: 'high', label: 'high', description: 'More thinking' }], defaultReasoningEffort: 'low' }], currentModel: 'alpha' } }));
  const sent = [];
  await page.route('**/chat/send', (route) => { sent.push(route.request().postDataJSON()); return route.fulfill({ json: { id: 'test-' + sent.length, accepted: true } }); });
  await page.goto(link); await page.goto('http://127.0.0.1:6010/bots/#/smoke');
  const input = page.getByRole('combobox', { name: 'Message or slash command' });
  await input.fill('/');
  await page.getByRole('option').filter({ hasText: '/model' }).waitFor();
  assert.equal(await page.getByRole('option').count(), 5);
  const runtimeColor = await page.getByRole('option').first().locator('span').last().evaluate((e) => getComputedStyle(e).color);
  const metorColor = await page.getByRole('option').last().locator('span').last().evaluate((e) => getComputedStyle(e).color);
  assert.notEqual(runtimeColor, metorColor);
  await page.screenshot({ path: '/tmp/metor-commands-desktop.png' });
  await input.fill('/mo'); assert.equal(await page.getByRole('option').count(), 1);
  await input.press('Tab'); assert.equal(await input.inputValue(), '/model ');
  await page.getByRole('option').filter({ hasText: 'Alpha' }).waitFor();
  await input.press('ArrowDown'); await input.press('Enter');
  assert.equal(await input.inputValue(), '/model beta ');
  await page.getByRole('listbox', {name: 'Reasoning effort'}).waitFor();
  assert.equal(await page.getByRole('option').count(), 2);
  await input.press('ArrowDown'); await input.press('Enter');
  assert.equal(await input.inputValue(), '/model beta high');
  assert.equal(await page.getByRole('listbox').count(), 0);
  await input.press('Enter'); await page.waitForFunction(() => document.querySelector('textarea').value === '');
  assert.equal(sent[0].command, 'harness:model'); assert.equal(sent[0].text, '/model beta high');
  console.log('PASS: distinct source colours, filtering, keyboard model picker and routing');
  await input.fill('/stop');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'origin' }).waitFor(); assert.equal(sent.length, 1);
  await page.getByRole('option').filter({ hasText: 'Runtime stop command' }).click();
  await input.press('Enter'); await page.waitForFunction(() => document.querySelector('textarea').value === '');
  assert.equal(sent[1].command, 'harness:stop');
  console.log('PASS: same name requires explicit origin and preserves selected action');
  await input.fill('/steps'); await input.press('Enter'); await input.press('Enter');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('metor.settings')).showSteps === true);
  assert.equal(sent.length, 2);
  await input.fill('/'); await input.press('Escape'); assert.equal(await page.getByRole('listbox').count(), 0);
  await input.fill('Normal message'); await input.press('Shift+Enter');
  assert.equal(sent.length, 2);
  await input.press('Enter'); await page.waitForFunction(() => document.querySelector('textarea').value === '');
  assert.equal(sent[2].text, 'Normal message'); assert.equal(sent[2].command, undefined);
  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('/'); await page.getByRole('listbox').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.waitForTimeout(400); // finish the responsive pane transition before visual inspection
  assert.ok((await page.getByRole('button', { name: 'Send', exact: true }).boundingBox()).x + (await page.getByRole('button', { name: 'Send', exact: true }).boundingBox()).width <= 390);
  await page.screenshot({ path: '/tmp/metor-commands-phone.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: local-only steps, Escape, normal multiline input and mobile layout');
} finally { await browser.close(); }
