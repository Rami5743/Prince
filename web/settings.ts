/**
 * What the player has chosen, and how the rest of the page hears about it.
 *
 * Five settings, all of them stored in the browser so that a reload opens
 * on the same game the player left. Four of the five can be changed while
 * the game is running; `map` cannot, because a different map is a
 * different game, and the opening page is the only place it is offered.
 *
 * **Nothing in `src/pop` reads any of this.** The engine is measured
 * against captures of a real PRINCE.EXE and must not learn that a player
 * has preferences: the language is a text table the shell hands to the
 * renderer, the quality is which pictures the renderer was given, and the
 * music is which device the sound player drives. The game plays the same
 * ticks whatever is chosen here, and `tools/dev/page-port.ts` goes on
 * requiring the page to draw the headless port's own picture.
 */

export type Language = 'en' | 'he';
export type Quality = 'original' | 'high';
export type Graphics = 'original';
export type Music = 'original';
export type MapChoice = 'original';
export type Aspect = 'original-4-3' | 'square-pixels';

export interface Settings {
  /** The language of every word on the page and in the game. */
  language: Language;
  /** `original` is the 320x200 the game shipped with. */
  quality: Quality;
  /** Which set of pictures. Only the game's own, for now. */
  graphics: Graphics;
  /** Which set of tunes. Only the game's own, for now. */
  music: Music;
  /** Which fourteen levels. Only the game's own, for now. */
  map: MapChoice;
  /** The shape of a pixel: as a CRT drew it, or square. */
  aspect: Aspect;
}

export const DEFAULTS: Settings = {
  language: 'en',
  quality: 'original',
  graphics: 'original',
  music: 'original',
  map: 'original',
  aspect: 'original-4-3',
};

/** The values each setting may take, in the order they are offered. */
export const CHOICES = {
  language: ['en', 'he'],
  quality: ['original', 'high'],
  graphics: ['original'],
  music: ['original'],
  map: ['original'],
  aspect: ['original-4-3', 'square-pixels'],
} as const satisfies { [K in keyof Settings]: readonly Settings[K][] };

const KEY = 'prince.settings.v1';

/** A setting the storage does not recognise is the default, not a crash. */
function clean(raw: unknown): Settings {
  const out = { ...DEFAULTS };
  if (typeof raw !== 'object' || raw === null) return out;
  const given = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const allowed = CHOICES[key] as readonly string[];
    const value = given[key];
    if (typeof value === 'string' && allowed.includes(value)) {
      (out as Record<string, string>)[key] = value;
    }
  }
  return out;
}

/**
 * The store.
 *
 * Every read goes through `get`, every write through `set`, and a write
 * tells the listeners which key moved so that a panel can redraw the one
 * thing that changed rather than the page.
 *
 * Browser storage can throw -- a private window, blocked site data -- so
 * both ends are wrapped and the page works with none of it: the settings
 * are then simply not remembered between loads.
 */
export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<(s: Settings, key: keyof Settings) => void>();

  constructor(initial?: Partial<Settings>) {
    this.value = clean({ ...read(), ...initial });
  }

  get all(): Readonly<Settings> { return this.value; }

  get<K extends keyof Settings>(key: K): Settings[K] { return this.value[key]; }

  /** Returns true when the value really moved. */
  set<K extends keyof Settings>(key: K, value: Settings[K]): boolean {
    const allowed = CHOICES[key] as readonly string[];
    if (!allowed.includes(value as string)) return false;
    if (this.value[key] === value) return false;
    this.value = { ...this.value, [key]: value };
    write(this.value);
    for (const listener of this.listeners) listener(this.value, key);
    return true;
  }

  /** Called with the whole settings object and the key that moved. */
  onChange(listener: (s: Settings, key: keyof Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function read(): Partial<Settings> {
  try {
    const text = window.localStorage.getItem(KEY);
    return text === null ? {} : (JSON.parse(text) as Partial<Settings>);
  } catch {
    return {};
  }
}

function write(value: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // A private window, or site data turned off. The game still plays.
  }
}

