

// Turns Azure DevOps models into terminal cards.
import { green, red, yellow, magenta, cyan, dim, bold } from './ansi.js';
import { seg, wrapChips, age } from './text.js';
const CHECK = {
  fail: ['✗', red],
  pending: ['●', yellow],
  pass: ['✓', green],
  skip: ['⊘', dim],
  none: ['·', dim],
};
const REVIEW = { approved: green, rejected: red, 'waiting for author': yellow, 'review required': yellow };
const WORK_ITEM_TYPE_PAINT = { Bug: red, Task: yellow, 'User Story': cyan, 'Product Backlog Item': cyan };
const SEVERITY_PAINT = { critical: magenta, high: red, medium: yellow, low: dim };

const isFailedRun = (r) => r.status === 'completed' && ['failed', 'partiallySucceeded'].includes(r.result);
function runState(r) {
  return r.status !== 'completed' ? 'pending' : r.result === 'succeeded' ? 'pass' : isFailedRun(r) ? 'fail' : 'skip';
}
function prCard(pr, width, now) {
  const [icon, paint] = CHECK[pr.checkState] || CHECK.none;
  const reviewPaint = REVIEW[pr.review] || dim;
  const chips = (pr.checks || []).map((c) => {
    const [i, p] = CHECK[c.state] || CHECK.none;
    return seg(`${i} ${c.name}${c.blocking ? '' : ' (optional)'}`, c.blocking ? p : dim);
  });
  return [
    [
      seg(`${icon} `, paint),
      seg(`#${pr.id} `, cyan),
      seg(`${pr.isDraft ? '[draft] ' : ''}${pr.title}`, bold),
      seg(pr.myVote >= 5 ? ' ★' : '', yellow),
    ],
    [
      seg('  '),
      seg(pr.review, reviewPaint),
      seg(` · ${pr.author}`, dim),
      seg(pr.threads ? ` · ✎${pr.threads}` : '', dim),
      seg(pr.autoComplete ? ' · auto-complete' : '', cyan),
      seg(` · ${age(pr.createdAt, now)}`, dim),
    ],
    ...(chips.length ? wrapChips(chips, width, '  ') : [[seg('  no checks', dim)]]),
  ];
}
function runCard(run, width, now) {
  const [icon, paint] = CHECK[runState(run)];
  return [
    [seg(`${icon} `, paint), seg(run.pipeline, bold), seg(` · ${run.branch}`, dim)],
    [seg(`  #${run.number} · ${age(run.queuedAt, now)}`, dim)],
  ];
}
function workItemCard(w, width, now) {
  const paint = WORK_ITEM_TYPE_PAINT[w.type] || dim;
  const details = [w.state, w.iteration, w.priority != null ? `P${w.priority}` : '', age(w.changedAt, now)]
    .filter(Boolean)
    .join(' · ');
  return [[seg('● ', paint), seg(`${w.type} #${w.id} `, cyan), seg(w.title, bold)], [seg(`  ${details}`, dim)]];
}
function alertCard(a) {
  const paint = SEVERITY_PAINT[a.severity] || dim;
  return [
    [seg(`${a.severity} `, paint), seg(a.title, bold)],
    [seg(`  ${[a.type, a.path].filter(Boolean).join(' · ')}`, dim)],
  ];
}
export { isFailedRun, runState, prCard, runCard, workItemCard, alertCard };
