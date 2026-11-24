import { div, svg } from 'gpui-kit';
import { v_flex, h_flex, Input, TextView, Editor } from 'gpui-base';
import { appHome, checking, props, theme, writeTextFile } from 'herdr';
import { validateConfig } from '../core/config.js';
import { failed, select, tabs } from './logic.js';

const names = ['PRs', 'CI', 'Work', 'Vulns'];

export const panel = {
  button(id, label, action) {
    const color = theme();
    return div().id(id).px(6).py(3).rounded(5).text_size(11).cursor_pointer().bg(color.raised)
      .hover((element) => element.bg(color.hover)).on_mouse_down('left', (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => {
        cx.stop_propagation();
        action(cx);
      }).child(label);
  },
  saveConfig(cx) {
    const text = this.configInput.value();
    cx.spawn(async (context) => {
      try {
        const config = validateConfig(JSON.parse(text));
        await writeTextFile(`${appHome()}/mods/herdr-ado/config.json`, `${JSON.stringify(config, null, 2)}\n`,
          this.configText);
        this.configText = `${JSON.stringify(config, null, 2)}\n`;
        this.config = config;
        localStorage.setItem('config', JSON.stringify(config));
        this.editingConfig = false;
        this.message = 'Config saved; reload the mod to change the refresh interval';
        this.handle.focus();
      } catch (error) {
        this.message = `Config: ${error.message}`;
      }
      context.notify();
    });
  },
  footer() {
    const color = theme();
    return div().text_color(color.dim).child(this.message || 'j/k select · enter view · r refresh · ? help');
  },
  render(cx) {
    if (this.launcher || this.closed || this.pending) return div();
    const color = theme();
    const detail = this.view;
    if (!checking()) this.follow(cx);
    const dialog = this.modal();
    const root = v_flex().id('ado').relative().size_full().min_h(0).bg(color.background)
      .text_color(color.foreground).text_size(12).track_focus(this.handle)
      .on_key_down((event, context) => this.key(event, context));
    const header = h_flex().h(42).flex_none().px(8).gap(5).items_center()
      .border_b(1).border_color(color.border)
      .when(Boolean(detail), (element) => element.child(this.button('back', '◀', (context) => this.back(context))))
      .child(div().flex_1().min_w(0).truncate().font_semibold().child(detail ? detail.title :
        this.repo ? `${this.repo.project}/${this.repo.repo}` : 'Azure DevOps'))
      .when(!detail && Boolean(this.repo), (element) => element.child(div().text_color(color.dim).child(this.repo.org)))
      .when(detail ? this.detailLoading : this.loading || this.refreshing, (element) =>
        element.child(svg('mods/workspace-chrome/spinner.svg').size(12).text_color(color.working).spin(900)))
      .child(this.button('refresh', '↻', (context) => detail ? this.loadDetail(context) : this.refresh(context)));
    if (detail) {
      header.child(this.button('browser', 'Open', (context) => this.open(this.detailUrl, context)));
      if (props()?.mode === 'window') header.child(this.button('close', '×', () => this.closeWindow()));
      root.child(header);
      const body = v_flex().flex_1().min_h(0);
      if (this.detailLoading) body.child(div().p(12).child('Loading…'));
      else if (this.detailError) body.child(div().p(10).child(this.detailText || ''));
      else if (detail.kind === 'pr' || detail.kind === 'workitem') body.child(div().flex_1().min_h(0)
        .overflow_y_scroll().p(10).child(TextView.markdown('ado-detail', this.detailText || '')));
      else body.child(this.editor ? Editor.new(this.editor).flex_1().min_h(0) : div().p(10));
      return root.child(body).child(v_flex().flex_none().p(8).border_t(1).border_color(color.border)
        .child(div().text_color(color.dim).child(this.message || 'Esc back · o open')))
        .when(Boolean(dialog), (element) => element.child(dialog));
    }
    header.child(this.button('float', props()?.mode === 'window' ? 'To pane' : 'Pop out',
      () => props()?.mode === 'window' ? this.toPane() : this.float()))
      .child(this.button('terminal', 'Terminal', (context) => this.terminal(context)))
      .child(this.button('help', '?', (context) => this.action('help', context)));
    if (props()?.mode === 'window') header.child(this.button('close', '×', () => this.closeWindow()));
    root.child(header);
    if (this.help) return root.child(v_flex().p(12).gap(8)
      .child('j/k or arrows select · g/G first/last · 1–4 or Tab switch · r refresh · p float · t terminal')
      .child('PR: c policies · a approve · m complete · v needs vote')
      .child('CI: R retry · f failures · Work: s state · c comment · o open · Enter view')
      .child('Config: edit with the config button')
      .child(JSON.stringify(this.config))
      .when(this.editingConfig, (element) => element.child(Input.new(this.configInput).h(36).px(6)
        .border_1().border_color(color.input).text_color(color.foreground))
        .child(this.button('save-config', 'Save', (context) => this.saveConfig(context))))
      .when(!this.editingConfig, (element) => element.child(this.button('config', 'Config', (context) => {
        this.configInput.set_value(JSON.stringify(this.config));
        this.editingConfig = true;
        this.configInput.focus();
        context.notify();
      })))
      .when(Boolean(this.message), (element) => element.child(this.message)))
      .when(Boolean(dialog), (element) => element.child(dialog));
    root.child(h_flex().px(6).py(5).gap(4).children(tabs(this.config).map((name, index) =>
      this.button(`tab-${index}`, `${name} ${this.rows[index].length}${index === 1 ?
        ` · ${this.rows[index].filter(failed).length}✗` : ''}`, (context) => {
        this.tab = index;
        this.index = 0;
        context.notify();
      }))));
    const rows = this.visible();
    this.index = select(this.index, 0, rows.length);
    if (this.message && (this.repo || rows.length)) {
      root.child(div().px(8).text_color(color.blocked).child(this.message));
    }
    root.child(v_flex().id('ado-list').flex_1().min_h(0)
      .overflow_y_scroll().track_scroll(this.scroll).p(6).gap(5)
      .children(rows.map((row, index) => this.card(row, index)))
      .when(!rows.length, (element) => element.child(div().p(8).text_color(color.dim)
        .child(this.loading ? 'Loading…' : this.repo ? `No ${names[this.tab]}` :
          this.message || `No Azure DevOps repository for ${this.cwd || this.space?.name || 'this space'}: ` +
            'cd into an ADO clone'))));
    root.child(v_flex().flex_none().p(8).gap(3).border_t(1).border_color(color.border)
      .when(Boolean(this.updated), (element) => element.child(div().text_size(10).text_color(color.dim)
        .child(`Updated ${this.updated}`))).child(this.footer()));
    return root.when(Boolean(dialog), (element) => element.child(dialog));
  }
};
