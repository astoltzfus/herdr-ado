import { test } from 'node:test';
import assert from 'node:assert/strict';

test('v2 runner returns errors and cleans temporary bodies', async () => {
  const { createAz } = await import('../mods/herdr-ado/core/az.js');
  let removed = false;
  const az = createAz({
    run: async () => ({ code: 1, stdout: '', stderr: 'ERROR: refused' }),
    tempFile: async () => ({ path: '/fake/body', remove: async () => { removed = true; } }),
  });
  await assert.rejects(az.invoke({ org: 'o' }, 'git', 'pullRequests', {}, { body: {} }),
    (error) => error.name === 'AzError' && az.errorMessage(error) === 'refused');
  assert.equal(removed, true);
});

test('v2 remote uses machine and caches are per instance', async () => {
  const { resolveRemote } = await import('../mods/herdr-ado/core/remote.js');
  const { createAz } = await import('../mods/herdr-ado/core/az.js');
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'git') {
      return { code: 0, stderr: '', stdout: args.includes('get-url')
        ? 'https://dev.azure.com/org/project/_git/repo' : 'origin' };
    }
    return { code: 0, stderr: '', stdout: '{"id":"one"}' };
  };
  assert.deepEqual(await resolveRemote(runner, '/repo', 'remote'), { org: 'org', project: 'project', repo: 'repo' });
  assert.ok(calls.every((call) => call.options.on === 'remote'));
  const first = createAz({ run: runner });
  const second = createAz({ run: runner });
  const repo = { org: 'org', project: 'project', repo: 'repo' };
  await first.repoInfo(repo);
  await first.repoInfo(repo);
  await second.repoInfo(repo);
  const azCalls = calls.filter((call) => call.command === 'az');
  assert.equal(azCalls.length, 2);
  assert.ok(azCalls.every((call) => !call.options.on));
});

test('v2 logs fetch a bounded tail and use extended timeouts', async () => {
  const { createAz } = await import('../mods/herdr-ado/core/az.js');
  const calls = [];
  const az = createAz({ run: async (_command, args, options) => {
    calls.push({ args, options });
    const hasLog = args.includes('logId=7');
    return { code: 0, stderr: '', stdout: JSON.stringify(hasLog
      ? { value: ['2026-01-01T00:00:00Z failure'] }
      : { value: [{ id: 7, lineCount: 500 }] }) };
  } });
  const logs = await az.fetchRunLogs({ org: 'o', project: 'p' }, { id: 2 },
    [{ type: 'Task', result: 'failed', name: 'task', log: { id: 7 } }], 100);
  assert.deepEqual(logs[0].lines, ['failure']);
  assert.ok(calls[1].args.includes('startLine=400'));
  assert.ok(calls.every((call) => call.options.timeout === 120000));
});

test('a runner that cannot start maps to the installation message', async () => {
  const { createAz } = await import('../mods/herdr-ado/core/az.js');
  const az = createAz({ run: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
  await assert.rejects(az.command(['account', 'show']), (error) => /Azure CLI not found/.test(az.errorMessage(error)));
});
