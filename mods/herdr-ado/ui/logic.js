export const tabs = (config) => config.security_tab ? ['PRs', 'CI', 'Work', 'Vulns'] : ['PRs', 'CI', 'Work'];
export const adoPaneIds = (panes, tab) => panes.filter((pane) => pane.mod === 'herdr-ado' && pane.tab === tab)
  .map((pane) => pane.pane);
export const newPaneId = (before, panes, tab) => adoPaneIds(panes, tab).find((id) => !before.includes(id)) ?? null;
export const existingPanel = (mine, panes, registry, tab) =>
  registry.find((id) => id !== mine && adoPaneIds(panes, tab).includes(id)) ?? null;
export function pruneRegistry(registry, panes, add) {
  const ids = panes.filter((pane) => pane.mod === 'herdr-ado').map((pane) => pane.pane);
  const result = registry.filter((id) => ids.includes(id));
  if (add != null && !result.includes(add)) result.push(add);
  return result;
}
export const failed = (run) => run.status === 'completed' && ['failed', 'partiallySucceeded'].includes(run.result);
export function runIcon(run) {
  if (failed(run)) return { icon: '✗', state: 'fail' };
  if (run.status !== 'completed') return { icon: '●', state: 'pending' };
  if (run.result === 'canceled') return { icon: '⊘', state: 'skip' };
  return { icon: '✓', state: 'pass' };
}
export function viewTitle(kind, row) {
  if (kind === 'pr') return `PR #${row.id} · ${row.title}`;
  if (kind === 'policies') return `Policies · PR #${row.id}`;
  if (kind === 'run') return `${failed(row) ? 'Logs' : 'Run'} · ${row.pipeline} #${row.number}`;
  return `${row.type} #${row.id} · ${row.title}`;
}
export function filtered(rows, tab, voteOnly, failuresOnly) {
  if (tab === 0 && voteOnly) return rows.filter((row) => row.isReviewer && row.myVote === 0 && !row.isAuthor);
  if (tab === 1 && failuresOnly) return rows.filter(failed);
  return rows;
}
export const select = (index, delta, length) => Math.max(0, Math.min(length - 1, index + delta));
export function keyAction(key, tab) {
  const common = { enter: 'view', o: 'open', r: 'refresh', p: 'float', t: 'terminal', '?': 'help' };
  const perTab = [{ c: 'policies', a: 'approve', m: 'complete', v: 'vote' },
    { R: 'retry', f: 'failures' }, { s: 'state', c: 'comment' }, {}];
  return common[key] || perTab[tab]?.[key];
}
export const blockedBy = (pr) => (pr.checks || []).filter((check) => check.blocking && check.state !== 'pass')
  .map((check) => check.name).join(', ') || pr.mergeStatus || 'merge conditions';
export function confirmTitle(action, row, extra = {}) {
  if (action === 'approve') return `Approve PR #${row.id}?`;
  if (action === 'complete') return extra.auto
    ? `Set auto-complete on PR #${row.id}?` : `Complete PR #${row.id}?`;
  if (action === 'retry') return `Retry ${row.pipeline} #${row.number}?`;
  if (action === 'state') return `Move #${row.id} to ${extra.state}?`;
  return `Post comment on #${row.id}?`;
}
export function confirmVerb(action, extra = {}) {
  if (action === 'approve') return 'Approve';
  if (action === 'complete') return extra.auto ? 'Set auto-complete' : 'Complete';
  if (action === 'retry') return 'Retry';
  if (action === 'state') return 'Move';
  return 'Post';
}
export function promptText(action, item, extra = {}) {
  const ref = `#${item.id} ${item.title}`;
  if (action === 'approve') return `approve ${ref}`;
  if (action === 'complete') return extra.auto
    ? `set auto-complete on ${ref} (${extra.strategy}); blocked by: ${blockedBy(item)}`
    : `complete ${ref} (${extra.strategy})`;
  if (action === 'state') return `move ${ref}: ${item.state} → ${extra.state}`;
  if (action === 'comment') return `comment on ${ref}: "${extra.text.length > 40
    ? `${extra.text.slice(0, 40)}…` : extra.text}"`;
  if (extra.plan.stages.length) return extra.plan.stages.length === 1 && extra.plan.stages[0].identifier === '__default'
    ? `retry failed jobs of ${item.pipeline} #${item.number}`
    : `retry failed stages ${extra.plan.stages.map((stage) => stage.name).join(', ')} ` +
      `of ${item.pipeline} #${item.number}`;
  return `queue a new run of ${item.pipeline} on ${item.branch} at ${String(item.sha || '').slice(0, 7)}`;
}
function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return (value >>> 0).toString(16).padStart(8, '0');
}
export function terminalName(repo) {
  const raw = `${repo.project}-${repo.repo}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const name = `ado-${raw}`;
  return name.length <= 32 ? name : `${name.slice(0, 23)}-${hash(`${repo.org}/${repo.project}/${repo.repo}`)}`;
}
export function terminalPlan(repo, space, node, home, result) {
  const name = terminalName(repo);
  if (result?.state === 'live' && result.address) return [
    { type: 'run', name: 'pane.focus', args: { terminal: result.address },
      fallback: { type: 'run', name: 'terminal.keep', args: { terminal: result.address, place: 'down' } } },
  ];
  const id = `${repo.org}/${repo.project}/${repo.repo}`;
  return [{ type: 'hc', args: ['run', '--bg', '--json', '--no-parent', '--outlive-parent', '--no-notify',
    '--name', name, '--label', 'app=herdr-ado', '--label', `herdr-ado.repo=${id}`, '--cwd', space.folder,
    '--', node, `${home}/mods/herdr-ado/terminal/panel.js`, id] },
  { type: 'run', name: 'terminal.keep', args: { terminal: '$address', place: 'down' } }];
}

// A mod pane has no cwd; remember the last terminal location in each space.
export function chooseCwd(space, focus, lastCwd, allPanes) {
  if (!space) return null;
  if (focus?.space === space.id && focus.terminal && focus.cwd) return focus.cwd;
  if (lastCwd) return lastCwd;
  const tab = space.tabs?.find((entry) => entry.active)?.id;
  const terminals = allPanes.filter((pane) => pane.tab === tab && pane.terminal != null && pane.cwd);
  return terminals.find((pane) => pane.focused)?.cwd || terminals[0]?.cwd || space.folder || null;
}
