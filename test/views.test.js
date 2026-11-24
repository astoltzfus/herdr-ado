import test from 'node:test';
import assert from 'node:assert/strict';
import * as views from '../mods/herdr-ado/core/views.js';
import { workItemCard } from '../mods/herdr-ado/terminal/cards.js';
import { renderLine } from '../mods/herdr-ado/terminal/text.js';
test('HTML and pager content are sanitized', () => {
  assert.match(views.htmlText('<p>A &amp; B</p><div>&#x41;\x1b[2J</div>'), /A & B/);
  assert.doesNotMatch(views.workItemText({ id: 1, fields: { 'System.Description': '<p>Hi\x1b[31m</p>' } }, []), /\x1b/);
  assert.doesNotMatch(views.logsText([{ name: 'bad\x1b[2J', lines: ['bad\x1b[31m'] }]), /\x1b/);
});
test('work item card contains state and priority', () => {
  const lines = workItemCard(
    { id: 1, type: 'Bug', title: 'Oops', state: 'Active', iteration: 'Sprint', priority: 1, changedAt: '2026-01-01' },
    80,
    Date.parse('2026-01-02'),
  )
    .map((x) => renderLine(x, 80))
    .join(' ');
  assert.match(lines, /Bug #1/);
  assert.match(lines, /Active · Sprint · P1/);
});

test('run summary hides the implicit stage and sole default job', () => {
  const text = views.runText({ pipeline: 'Build', number: '1' }, [
    { type: 'Stage', name: '__default' },
    { type: 'Job', name: 'Job' },
  ]);
  assert.doesNotMatch(text, /__default|Job/);
});

test('PR markdown preserves description and quotes comments while escaping metadata', () => {
  const result = views.prMarkdown({ pullRequestId: 4, title: 'Fix *title*\x1b', sourceRefName: 'feature/a',
    description: '## Heading\n- **bold** [link](https://example.com)\x1b',
    reviewers: [{ displayName: 'A * B', vote: 10 }] },
  [{ status: 'active', comments: [{ commentType: 'text', author: { displayName: 'Ann' },
    publishedDate: new Date().toISOString(), content: '**first**\nsecond\x1b' }] }]);
  assert.match(result, /Fix \\\*title\\\*/);
  assert.match(result, /## Heading\n- \*\*bold\*\*/);
  assert.match(result, /Ann · 0m\n> \*\*first\*\*\n> second/);
  assert.doesNotMatch(result, /\x1b/);
});

test('work item HTML becomes escaped text and comments become quotes', () => {
  const result = views.workItemMarkdown({ id: 9, fields: { 'System.Title': 'A [title]',
    'System.Description': '<p>Use &lt;tag&gt; and *text*\x1b</p>' } },
  [{ createdBy: { displayName: 'A * B' }, createdDate: new Date().toISOString(),
    text: '<p>hello &amp; *world*</p>' }]);
  assert.match(result, /A \\\[title\\\]/);
  assert.match(result, /Use &lt;tag&gt; and \\\*text\\\*/);
  assert.match(result, /A \\\* B · 0m\n> /);
  assert.match(result, /> hello &amp; \\\*world\\\*/);
  assert.doesNotMatch(result, /\x1b/);
});
