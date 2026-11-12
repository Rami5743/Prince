/**
 * Filling in the slots that cross a cycle between segments.
 *
 * `link.ts` declares the seams; this is the one place that fills them
 * in. It lived inside `game.ts` until the cutscenes needed it too: a
 * cutscene draws with `seg008` and plays sequences with `seg006`, and
 * those call back into `seg007` and `seg002` through the same slots a
 * level does.
 */
import { start_chompers, make_loose_fall, trigger_button, is_spike_harmful,
  start_anim_spike, set_wipe, set_redraw_full, set_redraw_fore, set_redraw2,
  set_redraw_floor_overlay, set_redraw_anim, died_on_button, draw_mobs,
} from './seg007.ts';
import {
  get_room_address, add_objtable, mark_obj_tile_redraw,
  mobs as drawMobs, hp as drawHp,
} from './seg008.ts';
import { control, seqtbl_offset_char, spiked, do_fall, dist as seg005dist } from './seg005.ts';
import {
  enter_guard, char_opp_dist, goto_other_room, autocontrol_opponent, clear_char,
  on_guard_killed, inc_curr_row, control_guard_inactive, hp as guardHp,
} from './seg002.ts';
import { dist as seg003dist, rooms as seg003rooms } from './seg003.ts';
import { draw_hp, draw_kid_hp, draw_guard_hp, add_life } from './seg000.ts';
import { l2, l5, l6, l7, l8, hud } from './link.ts';

let linked = false;

/** Fill in the slots that cross a cycle between segments. */
export function link(): void {
  if (linked) return;
  linked = true;
  l7.start_chompers.fn = start_chompers;
  l7.make_loose_fall.fn = make_loose_fall;
  l7.trigger_button.fn = trigger_button;
  l7.is_spike_harmful.fn = is_spike_harmful;
  l7.start_anim_spike.fn = start_anim_spike;
  l8.set_wipe.fn = set_wipe;
  l8.set_redraw_full.fn = set_redraw_full;
  l8.set_redraw_fore.fn = set_redraw_fore;
  l8.set_redraw2.fn = set_redraw2;
  l8.set_redraw_floor_overlay.fn = set_redraw_floor_overlay;
  l8.set_redraw_anim.fn = set_redraw_anim;
  l8.get_room_address.fn = get_room_address;
  l8.add_objtable.fn = add_objtable;
  l8.mark_obj_tile_redraw.fn = mark_obj_tile_redraw;
  l5.do_fall.fn = do_fall;
  l5.spiked.fn = spiked;
  l5.control.fn = control;
  l5.seqtbl_offset_char.fn = seqtbl_offset_char;
  l6.control_guard_inactive.fn = control_guard_inactive;
  l2.autocontrol_opponent.fn = autocontrol_opponent;
  l2.clear_char.fn = clear_char;
  l2.died_on_button.fn = died_on_button;
  l2.set_start_pos.fn = () => {};
  l2.on_guard_killed.fn = on_guard_killed;
  l2.inc_curr_row.fn = inc_curr_row;
  seg003dist.char_opp_dist = char_opp_dist;
  seg005dist.char_opp_dist = char_opp_dist;
  seg003rooms.goto_other_room = goto_other_room;
  drawMobs.draw_mobs = draw_mobs;
  drawHp.draw_hp = draw_hp;
  guardHp.draw_guard_hp = draw_guard_hp;
  guardHp.add_life = add_life;
  l2.add_life.fn = add_life;
  hud.draw_kid_hp.fn = draw_kid_hp;
  hud.draw_guard_hp.fn = draw_guard_hp;
}

