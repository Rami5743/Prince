/**
 * Every word the page itself says, in both languages.
 *
 * This is the chrome -- the opening page, the two margins, the buttons.
 * The words the *game* draws on its own screen are a different table and
 * a different problem, because they go through the original's own bitmap
 * font; they live beside the renderer.
 */
import type { Language } from './settings.ts';

export interface Strings {
  readonly dir: 'ltr' | 'rtl';
  readonly title: string;
  readonly subtitle: string;

  readonly start: string;
  readonly settings: string;
  readonly tools: string;
  readonly close: string;

  readonly language: string;
  readonly quality: string;
  readonly graphics: string;
  readonly music: string;
  readonly map: string;
  readonly aspect: string;

  readonly languageEn: string;
  readonly languageHe: string;
  readonly qualityOriginal: string;
  readonly qualityHigh: string;
  readonly original: string;
  readonly graphicsOriginal: string;
  readonly graphics14: string;
  readonly musicOriginal: string;
  readonly music13: string;
  readonly aspectCrt: string;
  readonly aspectSquare: string;

  readonly record: string;
  readonly recordStop: string;
  readonly recordSaved: string;
  /**
   * The word on the button, which is short in both languages, and the
   * whole phrase, which goes on its `title`.
   *
   * A slot row is a label and two buttons sharing one margin, and a
   * margin is 140 to 196 pixels wide. `Save game` wanted 65 pixels in
   * the 52 a button gets at 1024 by 700 and lost its last three
   * letters; Hebrew had been given the short word already and English
   * had not.
   */
  readonly saveGame: string;
  readonly loadGame: string;
  readonly saveGameFull: string;
  readonly loadGameFull: string;
  readonly slot: string;
  readonly empty: string;
  readonly saved: string;
  readonly loaded: string;
  readonly noSave: string;
  readonly deleteSlot: string;

  /**
   * The line under the game, which says what the page is doing.
   *
   * It is the one piece of chrome that sits against the game's own
   * screen rather than in a margin, so it is the one a player reads
   * while he plays -- and a Hebrew game with an English caption under
   * it reads as half done. `{n}` is filled in by `web/main.ts`.
   */
  readonly pressAnyKey: string;
  readonly skipScene: string;
  readonly hourUp: string;
  readonly pausedLine: string;
  readonly demoLine: string;
  readonly againLine: string;
  readonly lookingLine: string;
  readonly controls: string;
  readonly levelN: string;
  readonly theDemo: string;
  readonly roomN: string;
  readonly titleScreen: string;

  readonly potionRoom: string;
  /**
   * `potion.html`'s own panel, which `index.html` does not have.
   *
   * It was the last English left on a Hebrew page, and the reason is
   * worth the line: its words lived in `tools/dev/build-pages.mjs` --
   * the script that *writes* the page -- rather than here, so nothing
   * relabelled them when the language changed. They are here now and
   * `Chrome` draws the panel like every other.
   */
  readonly potionTitle: string;
  readonly potionHp: string;
  readonly potionFeather: string;
  readonly potionUpside: string;
  readonly potionRoomRow: string;
  readonly potionYes: string;
  readonly potionNo: string;
  /** `3 of 3`, because the two numbers do not join the same way. */
  readonly potionOf: string;
  readonly potionHow: string;
  readonly loading: string;
  readonly pressToBegin: string;
  readonly keysTitle: string;
  readonly keys: readonly (readonly [string, string])[];
}

const EN: Strings = {
  dir: 'ltr',
  title: 'Prince of Persia',
  subtitle: 'The 1990 DOS game, rebuilt to run here — reading the original’s own '
    + 'data files and the tables inside its executable.',

  start: 'Begin',
  settings: 'Settings',
  tools: 'Tools',
  close: 'Close',

  language: 'Language',
  quality: 'Quality',
  graphics: 'Graphics',
  music: 'Music',
  map: 'Map',
  aspect: 'Pixels',

  languageEn: 'English',
  languageHe: 'עברית',
  qualityOriginal: 'Original',
  qualityHigh: 'High',
  original: 'Original',
  graphicsOriginal: 'As released (1.0)',
  graphics14: 'Version 1.4',
  musicOriginal: 'As released (1.0)',
  music13: 'Version 1.3',
  aspectCrt: '4:3, as on a CRT',
  aspectSquare: 'Square',

  record: 'Record keys',
  recordStop: 'Stop and save',
  recordSaved: 'Recording saved',
  saveGame: 'Save',
  loadGame: 'Load',
  saveGameFull: 'Save game',
  loadGameFull: 'Load game',
  slot: 'Slot',
  empty: 'empty',
  saved: 'Game saved',
  loaded: 'Game loaded',
  noSave: 'Nothing saved there',
  deleteSlot: 'Erase',

  pressAnyKey: 'press any key to begin',
  skipScene: 'press Escape to skip',
  hourUp: 'the hour is up — press any key',
  pausedLine: 'paused — press any key',
  demoLine: 'the demo — press any key to play',
  againLine: 'press any key to begin the level again',
  lookingLine: 'looking around; press a key to play',
  controls: 'arrow keys or the numeric keypad to move, up to jump; '
    + 'hold shift to step carefully and to keep hold of a ledge, '
    + 'then up again to climb it',
  levelN: 'level {n}',
  theDemo: 'the demo',
  roomN: 'room {n}',
  titleScreen: 'title screen',

  potionRoom: 'the potion room',
  potionTitle: 'Potions',
  potionHp: 'hit points',
  potionFeather: 'feather',
  potionUpside: 'upside down',
  potionRoomRow: 'room',
  potionYes: 'yes',
  potionNo: 'no',
  potionOf: '{n} of {m}',
  potionHow: 'Walk up to a flask and press Shift to drink it. The corridor '
    + 'runs hurt, heal, life, feather, upside-down, and the one that opens '
    + 'the gates. Ctrl+A lays them all out afresh.',
  loading: 'loading the game’s data files…',
  pressToBegin: 'press any key to begin',
  keysTitle: 'Keys',
  keys: [
    ['Arrows', 'move; a corner jumps that way'],
    ['Shift', 'step carefully, hold a ledge'],
    ['Up, running', 'a running jump'],
    ['Space', 'the time left'],
    ['Esc', 'pause, again for one tick'],
    ['Ctrl+A', 'begin the level again'],
    ['Ctrl+R', 'back to the title'],
    ['Ctrl+S', 'sound off and on'],
    ['Shift+L', 'skip a level'],
    ['R', 'raise a fallen Prince'],
    ['K', 'fell the guard'],
    ['Shift+T', 'a flask'],
    ['Shift+S', 'a hit point'],
    ['Shift+W', 'the feather'],
    ['Shift+I', 'turn the screen over'],
    ['Shift+B', 'put the lights out'],
    ['+ / −', 'move the clock'],
    ['H J U N', 'look at the rooms around'],
    ['Ctrl+B', 'come back'],
  ],
};

const HE: Strings = {
  dir: 'rtl',
  title: 'נסיך פרס',
  subtitle: 'משחק הדוס משנת 1990, בנוי מחדש כדי לרוץ כאן — קורא את קובצי הנתונים '
    + 'המקוריים ואת הטבלאות שבתוך קובץ ההרצה שלו.',

  start: 'התחלה',
  settings: 'הגדרות',
  tools: 'כלים',
  close: 'סגירה',

  language: 'שפה',
  quality: 'איכות',
  graphics: 'גרפיקה',
  music: 'מוזיקה',
  map: 'מפה',
  aspect: 'פיקסלים',

  languageEn: 'English',
  languageHe: 'עברית',
  qualityOriginal: 'מקורית',
  qualityHigh: 'גבוהה',
  original: 'מקורית',
  graphicsOriginal: 'כפי שיצא (1.0)',
  graphics14: 'גרסה 1.4',
  musicOriginal: 'כפי שיצא (1.0)',
  music13: 'גרסה 1.3',
  aspectCrt: '4:3, כמו במסך קתודי',
  aspectSquare: 'מרובעים',

  record: 'הקלטת מקשים',
  recordStop: 'עצירה ושמירה',
  recordSaved: 'ההקלטה נשמרה',
  saveGame: 'שמירה',
  loadGame: 'טעינה',
  saveGameFull: 'שמירת משחק',
  loadGameFull: 'טעינת משחק',
  slot: 'משבצת',
  empty: 'ריקה',
  saved: 'המשחק נשמר',
  loaded: 'המשחק נטען',
  noSave: 'אין שם שמירה',
  deleteSlot: 'מחיקה',

  pressAnyKey: 'הקישו מקש כלשהו כדי להתחיל',
  skipScene: 'הקישו Esc כדי לדלג',
  hourUp: 'השעה תמה — הקישו מקש כלשהו',
  pausedLine: 'מושהה — הקישו מקש כלשהו',
  demoLine: 'ההדגמה — הקישו מקש כלשהו כדי לשחק',
  againLine: 'הקישו מקש כלשהו כדי להתחיל את השלב מחדש',
  lookingLine: 'מביטים סביב; הקישו מקש כדי לחזור לשחק',
  controls: 'חיצים או המקלדת הספרתית לתנועה, למעלה לקפיצה; '
    + 'החזיקו Shift לצעידה זהירה ולאחיזה בקצה, '
    + 'ואז שוב למעלה כדי לטפס',
  levelN: 'שלב {n}',
  theDemo: 'ההדגמה',
  roomN: 'חדר {n}',
  titleScreen: 'מסך הפתיחה',

  potionRoom: 'חדר השיקויים',
  potionTitle: 'שיקויים',
  potionHp: 'נקודות חיים',
  potionFeather: 'נוצה',
  potionUpside: 'היפוך',
  potionRoomRow: 'חדר',
  potionYes: 'כן',
  potionNo: 'לא',
  potionOf: '{n} מתוך {m}',
  potionHow: 'גשו אל הכד והקישו Shift כדי לשתות. המסדרון מסודר: פגיעה, '
    + 'ריפוי, נקודת חיים, נוצה, היפוך, והשיקוי שפותח את השערים. '
    + 'Ctrl+A פורס את כולם מחדש.',
  loading: 'טוען את קובצי המשחק…',
  pressToBegin: 'הקישו מקש כלשהו כדי להתחיל',
  keysTitle: 'מקשים',
  keys: [
    ['חיצים', 'תנועה; מקש פינתי קופץ לאותו כיוון'],
    ['Shift', 'צעידה זהירה ואחיזה בקצה'],
    ['למעלה בריצה', 'קפיצת ריצה'],
    ['רווח', 'הזמן שנותר'],
    ['Esc', 'השהיה, ושוב לצעד אחד'],
    ['Ctrl+A', 'התחלת השלב מחדש'],
    ['Ctrl+R', 'חזרה למסך הפתיחה'],
    ['Ctrl+S', 'כיבוי והדלקת הקול'],
    ['Shift+L', 'דילוג על שלב'],
    ['R', 'החייאת הנסיך'],
    ['K', 'הפלת השומר'],
    ['Shift+T', 'כד'],
    ['Shift+S', 'נקודת חיים'],
    ['Shift+W', 'הנוצה'],
    ['Shift+I', 'היפוך המסך'],
    ['Shift+B', 'כיבוי האורות'],
    ['+ / −', 'הזזת השעון'],
    ['H J U N', 'הצצה לחדרים הסמוכים'],
    ['Ctrl+B', 'חזרה'],
  ],
};

export function stringsFor(language: Language): Strings {
  return language === 'he' ? HE : EN;
}
