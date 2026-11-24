import { div, svg } from 'gpui-kit';
import { h_flex, Input, v_flex } from 'gpui-base';
import { theme } from 'herdr';

export const modal = {
  closeModal(cx) {
    if (this.confirmation && this.busy) return;
    this.confirmation = null;
    this.picker = null;
    this.comment = null;
    this.handle.focus();
    cx.notify();
  },
  modalButton(id, label, primary, action, busy = false) {
    const color = theme();
    const background = primary ? color.solid : color.raised;
    return h_flex().id(id).h(30).px(12).gap(6).items_center().rounded(8).border_1()
      .border_color(primary ? color.solid : color.input).bg(background)
      .text_color(primary ? color.solid_foreground : color.foreground)
      .when(!busy, (element) => element.cursor_pointer().hover((item) => item.opacity(0.88)))
      .on_click((_event, cx) => {
        cx.stop_propagation();
        if (!busy) action(cx);
      })
      .when(busy && primary, (element) => element.child(svg('mods/workspace-chrome/spinner.svg')
        .size(12).text_color(color.solid_foreground).spin(900)))
      .child(busy && primary ? `${label}…` : label);
  },
  modal() {
    const confirmation = this.confirmation;
    const picker = this.picker;
    const comment = this.comment;
    if (!confirmation && !picker && !comment) return null;
    const color = theme();
    const title = confirmation?.title || (picker ? `Set state · #${picker.row.id}` : `Comment on #${comment.id}`);
    const card = v_flex().w_full().max_w(380).p(16).gap(10).rounded(10).bg(color.popover)
      .border_1().border_color(color.border)
      .on_mouse_down('left', (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => cx.stop_propagation())
      // min_w(0) lets a long title (a pipeline run name) wrap instead of pushing Esc out of the card.
      .child(h_flex().items_start().gap(8).child(div().flex_1().min_w(0).font_semibold().text_size(14).child(title))
        .child(div().flex_none().text_color(color.dim).child('Esc')));
    if (confirmation) {
      card.child(div().text_color(color.muted).child(confirmation.text));
      if (confirmation.error) card.child(div().text_color(color.blocked).child(confirmation.error));
    } else if (picker) {
      card.child(v_flex().gap(4).children(picker.states.map((state, index) =>
        div().id(`state-${index}`).p(8).rounded(5).cursor_pointer()
          .bg(index === picker.index ? color.selected : color.popover)
          .hover((element) => element.bg(color.hover))
          .on_click((_event, cx) => {
            cx.stop_propagation();
            this.pickState(index, cx);
          }).child(state.name))));
    } else {
      card.child(Input.new(this.input).w_full().h(32).px(6).border_1().border_color(color.input)
        .text_color(color.foreground));
    }
    const buttons = h_flex().justify_end().gap(8);
    if (confirmation?.error) {
      buttons.child(this.modalButton('modal-close', 'Close', false, (cx) => this.closeModal(cx)));
    } else {
      buttons.child(this.modalButton('modal-cancel', 'Cancel', false, (cx) => this.closeModal(cx), this.busy));
      if (confirmation) buttons.child(this.modalButton('modal-confirm', confirmation.verb, true,
        (cx) => this.perform(cx), this.busy));
      if (comment) buttons.child(this.modalButton('modal-next', 'Next', true, (cx) => this.submitComment(cx)));
    }
    card.child(buttons);
    const backdrop = div().absolute().inset_0().bg(color.background).opacity(0.75)
      .on_mouse_down('left', (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => {
        cx.stop_propagation();
        this.closeModal(cx);
      });
    return div().id('ado-modal').absolute().inset_0().flex().items_center().justify_center().p(16)
      .child(backdrop).child(card);
  }
};
