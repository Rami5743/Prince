/**
 * The page around the game: the opening settings page, the title in one
 * margin and the two panels in the other.
 *
 * Every word of it is built here rather than written into the HTML, so
 * that changing the language relabels the whole page without a reload --
 * and so that there is one list of the settings rather than two that can
 * drift apart.
 *
 * It knows nothing about the game. What a control does is a callback the
 * caller passes in; what a control *offers* comes from `settings.ts`.
 */
import {
  CHOICES, type Aspect, type Language, type Quality, type Settings, type SettingsStore,
} from './settings.ts';
import { stringsFor, type Strings } from './strings.ts';
import { readSlot, SLOTS, type SaveGame } from './savegame.ts';

export interface ChromeHooks {
  /** The Begin button on the opening page. Also the gesture that lets the page sound. */
  begin(): void;
  aspect(value: Aspect): void;
  language(value: Language): void;
  quality(value: Quality): void;
  /** Returns true if a recording is running after the click. */
  toggleRecording(): boolean;
  save(slot: number): void;
  load(slot: number): void;
}

/** The settings offered in both places, in the order they are shown. */
const OPENING_FIELDS = ['language', 'quality', 'graphics', 'music', 'map'] as const;
/** `map` is not among them: a different map is a different game. */
const PANEL_FIELDS = ['language', 'quality', 'graphics', 'music', 'aspect'] as const;

export class Chrome {
  private readonly settings: SettingsStore;
  private readonly hooks: ChromeHooks;
  private s: Strings;
  private recording = false;
  private noteTimer = 0;

  constructor(settings: SettingsStore, hooks: ChromeHooks) {
    this.settings = settings;
    this.hooks = hooks;
    this.s = stringsFor(settings.get('language'));
    this.applyDirection();
    this.build();
    settings.onChange((_all, key) => {
      if (key === 'language') {
        this.s = stringsFor(this.settings.get('language'));
        this.applyDirection();
        this.build();
      }
      if (key === 'aspect') this.applyAspect();
    });
    this.applyAspect();
  }

  /** Hebrew turns the page over: the title goes to the right-hand margin. */
  private applyDirection(): void {
    const root = document.documentElement;
    root.lang = this.settings.get('language');
    root.dir = this.s.dir;
  }

  /** The shape of a pixel, which the canvas's width is worked out from. */
  private applyAspect(): void {
    const square = this.settings.get('aspect') === 'square-pixels';
    const root = document.documentElement;
    root.style.setProperty('--ar', square ? '320 / 200' : '4 / 3');
    root.style.setProperty('--ar-num', square ? '1.6' : '1.3333');
  }

  // ------------------------------------------------------------- building

  private build(): void {
    this.buildMargin();
    this.buildOpening();
    this.buildPanels();
  }

  /** `potion.html` is the same page with one level record swapped. */
  private get isPotionPage(): boolean {
    return (window as unknown as { __princePotionLevel?: boolean })
      .__princePotionLevel === true;
  }

  private get pageTitle(): string {
    return this.isPotionPage ? `${this.s.title} — ${this.s.potionRoom}` : this.s.title;
  }

  /**
   * The title margin, which is a title and nothing else.
   *
   * Clause 2 of the specification is "drop all the current prose", and
   * the paragraph under the title was the last of it. It is still on
   * the opening page, where it introduces the game; on the game page
   * the margin is the name and the width it gives up goes to the
   * picture.
   */
  private buildMargin(): void {
    text('page-title', this.pageTitle);
    text('keys-label', this.s.keysTitle);
    const keys = document.getElementById('keys');
    if (!keys) return;
    keys.replaceChildren();
    for (const [key, what] of this.s.keys) {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = what;
      keys.append(dt, dd);
    }
  }

  private buildOpening(): void {
    text('opening-title', this.pageTitle);
    text('opening-subtitle', this.s.subtitle);
    const fields = document.getElementById('opening-fields');
    if (fields) {
      fields.replaceChildren();
      for (const key of OPENING_FIELDS) fields.append(this.field(key));
    }
    const begin = document.getElementById('begin') as HTMLButtonElement | null;
    if (begin) {
      begin.textContent = this.s.start;
      begin.onclick = () => {
        this.dismissOpening();
        this.hooks.begin();
      };
    }
  }

  /** The opening page is gone for this visit; the panels carry on from here. */
  dismissOpening(): void {
    const opening = document.getElementById('opening');
    if (opening) opening.hidden = true;
  }

  private buildPanels(): void {
    text('settings-label', this.s.settings);
    text('tools-label', this.s.tools);

    const fields = document.getElementById('settings-fields');
    if (fields) {
      fields.replaceChildren();
      for (const key of PANEL_FIELDS) fields.append(this.field(key));
    }

    const record = document.getElementById('record') as HTMLButtonElement | null;
    if (record) {
      record.textContent = this.recording ? this.s.recordStop : this.s.record;
      record.classList.toggle('on', this.recording);
      record.onclick = () => {
        record.blur();
        this.recording = this.hooks.toggleRecording();
        record.textContent = this.recording ? this.s.recordStop : this.s.record;
        record.classList.toggle('on', this.recording);
        if (!this.recording) this.note(this.s.recordSaved);
      };
    }
    this.buildSlots();
    text('tool-note', '');
  }

  /** Three slots, each with what is in it, a save and a load. */
  buildSlots(): void {
    const host = document.getElementById('save-slots');
    if (!host) return;
    host.replaceChildren();
    for (const n of SLOTS) {
      const row = document.createElement('div');
      row.className = 'slot-row';

      const label = document.createElement('span');
      label.textContent = `${this.s.slot} ${n} — ${describe(readSlot(n), this.s)}`;
      label.title = label.textContent;

      const save = document.createElement('button');
      save.textContent = this.s.saveGame;
      save.title = `${this.s.saveGameFull} — ${this.s.slot} ${n}`;
      save.onclick = () => { save.blur(); this.hooks.save(n); };

      const load = document.createElement('button');
      load.textContent = this.s.loadGame;
      load.title = `${this.s.loadGameFull} — ${this.s.slot} ${n}`;
      load.disabled = readSlot(n) === null;
      load.onclick = () => { load.blur(); this.hooks.load(n); };

      row.append(label, save, load);
      host.append(row);
    }
  }

  /** A line under the tools that says what just happened, then clears. */
  note(message: string): void {
    text('tool-note', message);
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => text('tool-note', ''), 2500);
  }

  get strings(): Strings { return this.s; }

  /** True while the Tools panel is recording. */
  get isRecording(): boolean { return this.recording; }

  // -------------------------------------------------------------- a field

  private field<K extends keyof Settings>(key: K): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'field';
    const name = document.createElement('span');
    name.textContent = this.labelOf(key);
    const select = document.createElement('select');
    // A stable id, so that a test can reach one setting by name.
    select.id = `setting-${key}`;
    const choices = CHOICES[key] as readonly string[];
    for (const value of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = this.optionOf(key, value);
      select.append(option);
    }
    select.value = this.settings.get(key) as unknown as string;
    select.disabled = choices.length < 2;
    select.onchange = () => {
      const value = select.value as Settings[K];
      if (!this.settings.set(key, value)) return;
      if (key === 'aspect') this.hooks.aspect(value as Aspect);
      if (key === 'language') this.hooks.language(value as Language);
      if (key === 'quality') this.hooks.quality(value as Quality);
    };
    label.append(name, select);
    return label;
  }

  private labelOf(key: keyof Settings): string {
    switch (key) {
      case 'language': return this.s.language;
      case 'quality': return this.s.quality;
      case 'graphics': return this.s.graphics;
      case 'music': return this.s.music;
      case 'map': return this.s.map;
      case 'aspect': return this.s.aspect;
    }
  }

  private optionOf(key: keyof Settings, value: string): string {
    if (key === 'language') return value === 'he' ? this.s.languageHe : this.s.languageEn;
    if (key === 'quality') {
      return value === 'high' ? this.s.qualityHigh : this.s.qualityOriginal;
    }
    if (key === 'aspect') {
      return value === 'square-pixels' ? this.s.aspectSquare : this.s.aspectCrt;
    }
    return this.s.original;
  }
}

function text(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el && el.textContent !== value) el.textContent = value;
}

/** What a slot holds, in one line. */
function describe(save: SaveGame | null, s: Strings): string {
  if (!save) return s.empty;
  const when = new Date(save.savedAt);
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : ` · ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const level = save.level === 0 ? '—' : String(save.level);
  return `${level} · ${save.minutesLeft}′${stamp}`;
}
