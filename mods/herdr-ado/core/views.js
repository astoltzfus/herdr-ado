

// Plain-text views for the pager.
import { sanitize, age } from '../terminal/text.js';
const cleanLines = (s) =>
  String(s ?? '')
    .split(/\r?\n/)
    .map(sanitize)
    .join('\n');
function htmlText(html) {
  return cleanLines(
    String(html ?? '')
      .replace(/<(?:br\b[^>]*|\/?(?:p|div|li)\b[^>]*)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
        const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
        if (e[0] !== '#') return names[e.toLowerCase()] || m;
        const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try {
          return String.fromCodePoint(n);
        } catch {
          return '';
        }
      }),
  );
}
const vote = (v) =>
  ({ 10: 'approved', 5: 'approved with suggestions', 0: 'no vote', '-5': 'waiting for author', '-10': 'rejected' })[
    v
  ] || 'no vote';
function prText(pr, threads) {
  const lines = [
    `#${pr.pullRequestId} ${pr.title}`,
    `${pr.sourceRefName} → ${pr.targetRefName}`,
    `Author: ${pr.createdBy?.displayName || ''}`,
    `Status: ${pr.status || ''}${pr.isDraft ? ' (draft)' : ''}`,
    `Merge status: ${pr.mergeStatus || ''}`,
    '',
    pr.description || '',
    '',
    'Reviewers:',
    ...(pr.reviewers || []).map((r) => `  ${r.displayName}: ${vote(r.vote)}`),
  ];
  for (const thread of threads.filter((entry) => !entry.isDeleted)) {
    const context = thread.threadContext;
    const line = context?.rightFileStart?.line || context?.leftFileStart?.line || '';
    const location = context?.filePath ? ` · ${context.filePath}:${line}` : '';
    lines.push('', `Thread: ${thread.status || ''}${location}`);
    for (const comment of thread.comments || []) {
      if (!comment.isDeleted && comment.commentType === 'text') {
        lines.push(
          `  ${comment.author?.displayName || ''} · ${age(comment.publishedDate)}`,
          ...String(comment.content || '')
            .split('\n')
            .map((text) => `    ${text}`),
        );
      }
    }
  }
  return cleanLines(lines.join('\n'));
}
function policiesText(pr, policies) {
  const lines = policies.map((policy) => {
    const name =
      policy.configuration?.settings?.displayName ||
      policy.context?.buildDefinitionName ||
      policy.configuration?.settings?.statusName ||
      policy.configuration?.type?.displayName ||
      '?';
    const blocking = policy.configuration?.isBlocking ? 'blocking' : 'optional';
    const build = policy.context?.buildId ? ` · build ${policy.context.buildId}` : '';
    return `${policy.status} · ${blocking} · ${name}${build}`;
  });
  return cleanLines([`#${pr.id} ${pr.title}`, '', ...lines].join('\n'));
}

function runText(run, records) {
  const jobs = records.filter((record) => record.type === 'Job');
  // The default stage and sole default job are implementation details of single-stage YAML.
  const visible = records.filter(
    (record) =>
      ['Stage', 'Job'].includes(record.type) &&
      !(record.type === 'Stage' && record.name === '__default') &&
      !(record.type === 'Job' && record.name === 'Job' && jobs.length === 1),
  );
  const lines = visible.map((record) => {
    const indent = record.type === 'Job' ? '  ' : '';
    const icon = record.result === 'succeeded' ? '✓' : record.result === 'failed' ? '✗' : '●';
    const seconds = Math.max(0, Math.round((Date.parse(record.finishTime) - Date.parse(record.startTime)) / 1000));
    const duration = record.startTime && record.finishTime ? `· ${seconds}s` : '';
    return `${indent}${icon} ${record.name} · ${record.result || record.state || ''} ${duration}`;
  });
  const heading = [`${run.pipeline} #${run.number}`, `${run.branch} · ${run.status} · ${run.result || ''}`];
  return cleanLines([...heading, '', ...lines].join('\n'));
}

function logsText(logs) {
  return logs.map((l) => `=== ${sanitize(l.name)}\n${l.lines.map(sanitize).join('\n')}`).join('\n\n');
}
function workItemText(item, comments) {
  const f = item.fields || {};
  return cleanLines(
    [
      `#${item.id} ${f['System.Title'] || ''}`,
      `${f['System.WorkItemType'] || ''} · ${f['System.State'] || ''}`,
      '',
      htmlText(f['System.Description']),
      '',
      'Comments:',
      ...comments.map((comment) => {
        const author = sanitize(comment.createdBy?.displayName);
        return `${author} · ${sanitize(comment.createdDate)}\n${htmlText(comment.text)}`;
      }),
    ].join('\n'),
  );
}
export { htmlText, prText, policiesText, runText, logsText, workItemText };

const markdownValue = (value) => sanitize(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1');
const markdownLines = (value) => cleanLines(value);
const quote = (text) => markdownLines(text).split('\n').map((line) => `> ${line}`).join('\n');

export function prMarkdown(pr, threads = []) {
  const lines = [
    `# #${markdownValue(pr.pullRequestId)} ${markdownValue(pr.title)}`,
    // A list, because markdown joins consecutive plain lines into one paragraph.
    `- ${markdownValue(pr.sourceRefName)} → ${markdownValue(pr.targetRefName)}`,
    `- Author: ${markdownValue(pr.createdBy?.displayName)}`,
    `- Status: ${markdownValue(pr.status)}${pr.isDraft ? ' (draft)' : ''}`,
    `- Merge status: ${markdownValue(pr.mergeStatus)}`,
    '', markdownLines(pr.description), '', '## Reviewers',
    ...(pr.reviewers || []).map((reviewer) =>
      `- ${markdownValue(reviewer.displayName)}: ${markdownValue(vote(reviewer.vote))}`),
  ];
  for (const thread of threads.filter((entry) => !entry.isDeleted)) {
    const context = thread.threadContext;
    const line = context?.rightFileStart?.line || context?.leftFileStart?.line || '';
    const location = context?.filePath ? ` · ${markdownValue(context.filePath)}:${markdownValue(line)}` : '';
    lines.push('', `### Thread: ${markdownValue(thread.status)}${location}`);
    for (const comment of thread.comments || []) {
      if (comment.isDeleted || comment.commentType !== 'text') continue;
      lines.push('', `${markdownValue(comment.author?.displayName)} · ${markdownValue(age(comment.publishedDate))}`,
        quote(comment.content));
    }
  }
  return lines.join('\n');
}

export function workItemMarkdown(item, comments = []) {
  const fields = item.fields || {};
  const lines = [
    `# #${markdownValue(item.id)} ${markdownValue(fields['System.Title'])}`,
    `${markdownValue(fields['System.WorkItemType'])} · ${markdownValue(fields['System.State'])}`,
    '', htmlText(fields['System.Description']).split('\n').map(markdownValue).join('\n'), '', '## Comments',
  ];
  for (const comment of comments) {
    lines.push('', `${markdownValue(comment.createdBy?.displayName)} · ${markdownValue(age(comment.createdDate))}`,
      quote(htmlText(comment.text).split('\n').map(markdownValue).join('\n')));
  }
  return lines.join('\n');
}
