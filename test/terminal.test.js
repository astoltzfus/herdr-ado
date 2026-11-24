import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../mods/herdr-ado/terminal/app.js';
import { createAz } from '../mods/herdr-ado/core/az.js';
const actual = createAz({});
import { stripAnsi, deferred } from './helpers/fake.js';
const config = {
  refresh_seconds: 120,
  merge_method: 'merge',
  delete_source_branch: false,
  run_limit: 20,
  log_tail_lines: 300,
  security_tab: false,
  work_item_hidden_states: ['Done'],
};
const repo = { org: 'o', project: 'p', repo: 'r' };
function setup(extra = {}) {
  const calls = [];
  const p = {
    id: 1,
    title: 'Title',
    author: 'A',
    headSha: 'abc',
    isReviewer: true,
    myVote: 0,
    isAuthor: false,
    checkState: 'pass',
    checks: [{ name: 'build', state: 'pass', blocking: true }],
    mergeStatus: 'succeeded',
    createdAt: '2026-01-01',
    projectId: 'p',
    repoId: 'r',
  };
  const w = { id: 2, title: 'Task', type: 'Task', state: 'Active', changedAt: '2026-01-01' };
  const data = { prs: [p], work: [w], folder: '/a', label: 'space' };
  const frames = [];
  const az = {
    ...actual,
    findReposByName: async () => [repo],
    fetchPrs: async () => data.prs,
    fetchRuns: async () => [],
    fetchWorkItems: async () => data.work,
    fetchAlerts: async () => [],
    completePr: async (...a) => calls.push(['complete', ...a]),
    approvePr: async (...a) => calls.push(['approve', ...a]),
    workStates: async () => [{ name: 'Active' }, { name: 'Done' }],
    updateState: async (...a) => calls.push(['state', ...a]),
    commentWorkItem: async (...a) => calls.push(['comment', ...a]),
  };
  const terminal = {
    columns: () => 80,
    rows: () => 20,
    write: (s) => frames.push(s),
    pageText: (s) => calls.push(['page', s]),
    openUrl: (s) => calls.push(['open', s]),
    quit: () => calls.push(['quit']),
  };
  const app = createApp({
    az,
    currentSpace: async () => ({ label: data.label }),
    spaceFolder: async () => data.folder,
    resolveRemote: async () => null,
    config: { ...config, ...extra },
    terminal,
  });
  return { app, data, calls, frames, az };
}
test('tabs, filter, completion and auto-complete', async () => {
  const t = setup();
  await t.app.watchSpace();
  assert.equal(t.app.getState().rows.length, 3);
  await t.app.handleInput('v');
  assert.equal(t.app.getState().voteOnly, true);
  await t.app.handleInput('m');
  assert.match(t.app.getState().confirm.prompt, /complete #1.*noFastForward/);
  await t.app.handleInput('y');
  assert.equal(t.calls[0][0], 'complete');
  assert.equal(t.calls[0].at(-1), false);
  t.data.prs[0] = { ...t.data.prs[0], mergeStatus: 'conflicts' };
  await t.app.refresh();
  await t.app.handleInput('m');
  assert.match(t.app.getState().confirm.prompt, /auto-complete/);
  await t.app.handleInput('y');
  assert.equal(t.calls.at(-1).at(-1), true);
  assert.equal(setup({ security_tab: true }).app.getState().rows.length, 4);
});
test('state picker and comment input take precedence over global keys', async () => {
  const t = setup();
  await t.app.watchSpace();
  await t.app.handleInput('3s');
  assert.equal(t.app.getState().picker.states[0].name, 'Done');
  await t.app.handleInput('\r');
  assert.match(t.app.getState().confirm.prompt, /Active → Done/);
  await t.app.handleInput('y');
  assert.equal(t.calls.at(-1)[0], 'state');
  await t.app.handleInput('c');
  await t.app.handleInput('q2');
  assert.equal(t.app.getState().input.text, 'q2');
  assert.equal(t.app.getState().tab, 2);
  await t.app.handleInput('\x1b');
  assert.equal(t.app.getState().input, null);
  await t.app.handleInput('chi\r');
  assert.match(t.app.getState().confirm.prompt, /hi/);
  await t.app.handleInput('y');
  assert.equal(t.calls.at(-1)[0], 'comment');
});
test('security disabled notice, folder changes, stale refresh', async () => {
  const t = setup({ security_tab: true });
  t.az.fetchAlerts = async () => {
    throw new Error('VS2150009');
  };
  await t.app.watchSpace();
  await t.app.handleInput('4');
  assert.match(stripAnsi(t.frames.at(-1)), /Advanced Security is not enabled/);
  const slow = deferred();
  t.az.fetchPrs = async () => slow.promise;
  const first = t.app.refresh();
  await new Promise(setImmediate);
  t.data.folder = '/b';
  await t.app.watchSpace();
  t.az.fetchPrs = async () => [];
  slow.resolve([{ id: 99 }]);
  await first;
  assert.equal(t.app.getState().folder, '/b');
  assert.deepEqual(t.app.getState().rows[0], []);
});

test('retry of the implicit stage names the pipeline rather than the stage', async () => {
  const t = setup();
  t.az.fetchRuns = async () => [{ id: 9, pipeline: 'Build', number: '42', status: 'completed', result: 'failed' }];
  t.az.fetchTimeline = async () => [{ type: 'Stage', name: '__default', identifier: '__default', result: 'failed' }];
  await t.app.watchSpace();
  await t.app.handleInput('2');
  await t.app.handleInput('R');
  assert.equal(t.app.getState().confirm.prompt, 'retry failed jobs of Build #42');
});

test('a draft pull request cannot be completed', async () => {
  const t = setup();
  t.data.prs[0].isDraft = true;
  await t.app.watchSpace();
  await t.app.handleInput('m');
  assert.equal(t.app.getState().confirm, null);
  assert.match(stripAnsi(t.frames.at(-1)), /#1 is a draft/);
});

test('help closes before normal shortcuts are processed', async () => {
  const t = setup();
  await t.app.watchSpace();
  await t.app.handleInput('?');
  await t.app.handleInput('q');
  assert.equal(t.app.getState().help, false);
  assert.equal(
    t.calls.some((call) => call[0] === 'quit'),
    false,
  );
});
test('renders cards at phone width without exceeding the screen', async () => {
  const sample = setup();
  sample.data.prs[0].checks.push({ name: 'a long integration check', state: 'pending', blocking: true });
  const terminal = { columns: () => 45, rows: () => 20, write: (frame) => sample.frames.push(frame) };
  const app = createApp({ az: sample.az, config, repo, terminal });
  await app.refresh();
  const frame = stripAnsi(sample.frames.at(-1));
  for (const line of frame.split('\r\n')) assert.ok([...line].length <= 44, line);
  assert.match(frame, /integration/);
});
