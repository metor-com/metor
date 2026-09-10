import test from 'node:test';
import assert from 'node:assert/strict';
import { commandCatalogue, resolveCommand, acpModelConfig, attachAcpCommands } from '../bin/metor-commands.mjs';
import { METOR_COMMANDS, matchingCommands, exactCommand } from '../../../frontend/src/lib/commands.js';

test('catalogue preserves runtime spelling and origin, and rejects unadvertised actions', () => {
  const models = [{ id: 'actual-model', label: 'Actual model' }];
  const commands = commandCatalogue([{ name: 'models', description: 'Models' }, { name: 'stop', description: 'Runtime stop' }], models);
  assert.equal(commands.some((c) => c.name === 'model'), false);
  assert.equal(commands[0].action, 'model');
  assert.equal(commands[1].origin, 'harness');
  assert.equal(resolveCommand({ commands, models }, 'harness:models', '/models actual-model').argument, 'actual-model');
  assert.throws(() => resolveCommand({ commands, models }, 'harness:models', '/models invented'));
  assert.throws(() => resolveCommand({ commands, models }, 'harness:stop', '/models actual-model'));
  assert.throws(() => resolveCommand({ commands, models }, 'harness:quit', '/quit'));
});
test('autocomplete filters names and requires an origin for collisions', () => {
  const commands = [...commandCatalogue([{ name: 'stop' }], [{ id: 'model' }]), ...METOR_COMMANDS];
  assert.deepEqual(matchingCommands(commands, '/mo').map((c) => c.name), ['model']);
  assert.equal(matchingCommands(commands, 'some /mo').length, 0);
  assert.equal(exactCommand(commands, '/stop', null), null);
  assert.equal(exactCommand(commands, '/stop', 'metor:stop').origin, 'metor');
  assert.equal(exactCommand(commands, '/stop', 'harness:stop').origin, 'harness');
});
test('ACP discovers grouped models and applies only a confirmed configuration', async () => {
  const option = { id: 'which-model', category: 'model', type: 'select', currentValue: 'a', options: [{ name: 'Family', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }] };
  assert.deepEqual(acpModelConfig({ configOptions: [option] }).models.map((m) => m.id), ['a', 'b']);
  let capabilities, call, reject = false;
  const core = { setCapabilities: (commands, models, current) => { capabilities = { commands, models, current }; } };
  const adapter = attachAcpCommands(core, async (method, params) => {
    call = { method, params };
    return reject ? { error: { message: 'Denied' } } : { result: { configOptions: [{ ...option, currentValue: params.value }] } };
  }, () => 'same-session');
  adapter.init({ configOptions: [option] });
  adapter.update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'models' }] });
  await adapter.setModel('b');
  assert.deepEqual(call, { method: 'session/set_config_option', params: { sessionId: 'same-session', configId: 'which-model', value: 'b' } });
  assert.equal(capabilities.current, 'b');
  reject = true; await assert.rejects(adapter.setModel('a'), /Denied/);
  assert.equal(capabilities.current, 'b');
  adapter.update({ sessionUpdate: 'available_commands_update', availableCommands: [] });
  assert.equal(capabilities.commands.length, 0);
});
test('older ACP sessions use set_model and keep the original model id', async () => {
  let call;
  const adapter = attachAcpCommands({ setCapabilities() {} }, async (method, params) => { call = { method, params }; return { result: {} }; }, () => 'existing');
  adapter.init({ models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto', name: 'Auto' }] } });
  await adapter.setModel('auto');
  assert.deepEqual(call, { method: 'session/set_model', params: { sessionId: 'existing', modelId: 'auto' } });
});

test('model switches validate effort per model and select its default instead of retaining an incompatible level', () => {
  const models = [
    { id: 'deep', reasoningEfforts: [{ id: 'low' }, { id: 'high' }], defaultReasoningEffort: 'low' },
    { id: 'fast', reasoningEfforts: [{ id: 'minimal' }], defaultReasoningEffort: 'minimal' },
    { id: 'plain' },
  ];
  const capabilities = { commands: commandCatalogue([], models), models };
  const resolve = (text) => resolveCommand(capabilities, 'harness:model', text);
  assert.equal(resolve('/model deep high').effort, 'high');
  assert.equal(resolve('/model fast').effort, 'minimal');
  assert.equal(resolve('/model plain').effort, null);
  assert.throws(() => resolve('/model fast high'), /supported/);
  assert.throws(() => resolve('/model deep high extra'), /supported/);
  assert.throws(() => resolve('/model plain high'), /supported/);
});
