const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

const commandFile = path.join(__dirname, '../commands/project.js');
const commandSource = fs.readFileSync(commandFile, 'utf8');
const commandRequire = createRequire(commandFile);

// Exercise the real command and filesystem, with API/auth and process exit isolated.
function setup(t, name, flows = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lamatic-project-get-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'cwd');
  fs.mkdirSync(cwd);
  const messages = [];
  const detailCalls = [];
  let flowListCalls = 0;
  const api = {
    getProject: async () => ({ id: 'project-id', name }),
    getFlows: async () => { flowListCalls++; return { flows }; },
    getFlowDetail: async ({ flowId }) => {
      detailCalls.push(flowId);
      return { id: flowId, nodes: [] };
    },
  };
  const commandModule = { exports: {} };
  vm.runInNewContext(commandSource, {
    module: commandModule,
    require: (id) => {
      if (id === '../utils/api') return api;
      if (id === '../utils/config') return { getConfig: () => ({ apiKey: 'test-key' }) };
      return commandRequire(id);
    },
    process: { cwd: () => cwd, exit: (code) => { throw new Error(`exit:${code}`); } },
    console: {
      log: (message) => messages.push(String(message)),
      error: (message) => messages.push(String(message)),
    },
  }, { filename: commandFile });

  return {
    root, cwd, messages, detailCalls,
    flowListCalls: () => flowListCalls,
    run: () => commandModule.exports.parseAsync(
      ['get', '--project-id', 'project-id', '--org-id', 'org-id'], { from: 'user' }
    ),
  };
}

const invalidNames = [
  undefined, null, 42, '', ' ', '.', '..',
  '../outside', '..\\outside', 'a/../../outside', 'a\\..\\..\\outside',
  '/tmp/outside', 'C:\\outside', 'C:outside', '\\\\server\\share',
  'nested/name', 'nested\\name', 'name:stream', 'bad\0name', 'bad\nname',
  'CON', 'nul.txt', 'COM1', 'LPT\u00b9', 'name.', 'name ',
];

for (const name of invalidNames) {
  test(`rejects project name ${JSON.stringify(name)} before creating anything`, async (t) => {
    const env = setup(t, name);
    await assert.rejects(env.run(), /exit:1/);
    assert.ok(env.messages.some((message) => message.includes('Invalid project name')));
    assert.deepEqual(fs.readdirSync(env.root), ['cwd']);
    assert.deepEqual(fs.readdirSync(env.cwd), []);
    assert.equal(env.flowListCalls(), 0);
  });

  test(`skips flow slug ${JSON.stringify(name)} and downloads valid flows`, async (t) => {
    const env = setup(t, 'My project', [
      { id: 'bad', name: 'Unsafe flow', slug: name },
      { id: 'good', name: 'Valid flow', slug: 'safe-flow' },
    ]);
    const sentinel = path.join(env.cwd, 'outside.json');
    fs.writeFileSync(sentinel, 'keep me');
    await env.run();
    assert.deepEqual(env.detailCalls, ['good']);
    assert.ok(env.messages.some((message) => message.includes('Invalid flow slug')));
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep me');
    assert.deepEqual(fs.readdirSync(env.root), ['cwd']);
    assert.deepEqual(fs.readdirSync(env.cwd).sort(), ['My project', 'outside.json']);
    const base = path.join(env.cwd, 'My project');
    assert.deepEqual(fs.readdirSync(base).sort(), ['flows', 'stores', 'tools']);
    assert.deepEqual(fs.readdirSync(path.join(base, 'flows')), ['safe-flow.json']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'flows/safe-flow.json'), 'utf8')),
      { id: 'good', nodes: [] });
  });
}

test('traversal slugs cannot overwrite a file outside the project', async (t) => {
  const env = setup(t, 'project', [
    { id: 'posix', slug: '../../outside', name: 'POSIX traversal' },
    { id: 'windows', slug: '..\\..\\outside', name: 'Windows traversal' },
  ]);
  const sentinel = path.join(env.cwd, 'outside.json');
  fs.writeFileSync(sentinel, 'keep me');
  await env.run();
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep me');
  assert.deepEqual(env.detailCalls, []);
  assert.deepEqual(fs.readdirSync(path.join(env.cwd, 'project/flows')), []);
});

test('preserves valid names with spaces, Unicode, dots, and underscores', async (t) => {
  const env = setup(t, 'Caf\u00e9 project.v1', [{ id: 'good', slug: 'my_flow.v1', name: 'Flow' }]);
  await env.run();
  assert.ok(fs.existsSync(path.join(env.cwd, 'Caf\u00e9 project.v1/flows/my_flow.v1.json')));
});

test('skips an existing project directory without overwriting its files', async (t) => {
  const env = setup(t, 'existing');
  fs.mkdirSync(path.join(env.cwd, 'existing'));
  const sentinel = path.join(env.cwd, 'existing/keep.txt');
  fs.writeFileSync(sentinel, 'keep me');
  await env.run();
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep me');
  assert.equal(env.flowListCalls(), 0);
});
