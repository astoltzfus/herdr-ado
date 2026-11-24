import { div } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { theme } from 'herdr';
import { age } from '../terminal/text.js';
import { failed, runIcon } from './logic.js';

export const cards = {
  card(row, index) {
    const color = theme();
    const selected = index === this.index;
    const colors = { pass: color.done, fail: color.blocked, pending: color.working, skip: color.dim, none: color.dim };
    // Runs use the terminal green: some themes (win98, atom) make `done` blue.
    const runColors = { ...colors, pass: color.ansi2 || color.done };
    const icons = { pass: '✓', fail: '✗', pending: '●', skip: '⊘', none: '·' };
    let title, subtitle, chips = [];
    if (this.tab === 0) {
      title = `${icons[row.checkState] || '·'} #${row.id} ${row.isDraft ? '[draft] ' : ''}${row.title}`;
      subtitle = `${row.review} · ${row.author}${row.myVote >= 5 ? ' ★' : ''}` +
        `${row.threads ? ` · ✎${row.threads}` : ''}${row.autoComplete ? ' · auto-complete' : ''}` +
        ` · ${age(row.createdAt)}`;
      chips = (row.checks || []).map((check) => div().px(4).rounded(4).bg(color.raised)
        .text_color(check.blocking ? colors[check.state] : color.dim)
        .child(`${icons[check.state] || '·'} ${check.name}${check.blocking ? '' : ' (optional)'}`));
    } else if (this.tab === 1) {
      title = `${row.pipeline} · ${row.branch}`;
      subtitle = `#${row.number} · ${age(row.queuedAt)}`;
    } else if (this.tab === 2) {
      title = `● ${row.type} #${row.id} ${row.title}`;
      subtitle = [row.state, row.iteration, row.priority != null ? `P${row.priority}` : '', age(row.changedAt)]
        .filter(Boolean).join(' · ');
    } else {
      title = `${row.severity} ${row.title}`;
      subtitle = [row.type, row.path].filter(Boolean).join(' · ');
    }
    // Only failed runs can be retried, so don't offer it on the others.
    const actions = [['view', 'policies', 'approve', 'complete', 'open'],
      failed(row) ? ['view', 'retry', 'open'] : ['view', 'open'],
      ['view', 'state', 'comment', 'open'], ['open']][this.tab];
    const labels = { view: this.tab === 1 ? 'Log' : 'View', policies: 'Policies', approve: 'Approve',
      complete: 'Complete', open: 'Open', retry: 'Retry', state: 'State', comment: 'Comment' };
    return v_flex().id(`card-${this.tab}-${row.id}`).p(8).gap(4).rounded(7).cursor_pointer()
      .bg(selected ? color.selected : color.surface).hover((element) => element.bg(color.hover))
      .on_click((event, cx) => {
        this.index = index;
        this.handle.focus();
        if (event.click_count >= 2) this.action('view', cx, row);
        cx.notify();
      })
      .child(this.tab === 1 ? h_flex().gap(4).child(div().text_color(runColors[runIcon(row).state])
        .child(runIcon(row).icon)).child(div().text_color(color.foreground).child(title)) :
        div().text_color(this.tab === 0 ? colors[row.checkState] || color.foreground :
          this.tab === 2 ? ({ Bug: color.blocked, Task: color.working, 'User Story': color.accent,
            'Product Backlog Item': color.accent }[row.type] || color.foreground) : color.foreground)
        .child(title))
      .child(div().text_size(11).text_color(color.muted).child(subtitle))
      .when(chips.length > 0, (element) => element.child(h_flex().flex_wrap().gap(4).children(chips)))
      .when(selected, (element) => element.child(h_flex().gap(4).children(actions.map((action) =>
        this.button(`action-${action}`, labels[action], (cx) => this.action(action, cx, row))))));
  }
};
