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
  readonly aspectCrt: string;
  readonly aspectSquare: string;

  readonly record: string;
  readonly recordStop: string;
  readonly recordSaved: string;
  readonly saveGame: string;
  readonly loadGame: string;
  readonly slot: string;
  readonly empty: string;
  readonly saved: string;
  readonly loaded: string;
  readonly noSave: string;
  readonly deleteSlot: string;

  readonly potionRoom: string;
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
  aspectCrt: '4:3, as on a CRT',
  aspectSquare: 'Square',

  record: 'Record keys',
  recordStop: 'Stop and save',
  recordSaved: 'Recording saved',
  saveGame: 'Save game',
  loadGame: 'Load game',
  slot: 'Slot',
  empty: 'empty',
  saved: 'Game saved',
  loaded: 'Game loaded',
  noSave: 'Nothing saved there',
  deleteSlot: 'Erase',

  potionRoom: 'the potion room',
  loading: 'loading the game’s data files…',
  pressToBegin: 'press any key to begin',
  keysTitle: 'Keys',
  keys: [
    ['Arrows / keypad', 'move; a corner jumps that way'],
    ['Shift', 'step carefully, take hold of a ledge'],
    ['Up while running', 'a running jump'],
    ['Space', 'the time left'],
    ['Esc', 'pause, and again for one tick'],
    ['Ctrl+A', 'begin the level again'],
    ['Ctrl+R', 'back to the title'],
    ['Ctrl+S', 'sound off and on'],
    ['Shift+L', 'skip a level'],
    ['R', 'raise a fallen Prince'],
    ['K', 'fell the guard'],
    ['Shift+T / Shift+S', 'a flask / a hit point'],
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
  aspectCrt: '4:3, כמו במסך קתודי',
  aspectSquare: 'מרובעים',

  record: 'הקלטת מקשים',
  recordStop: 'עצירה ושמירה',
  recordSaved: 'ההקלטה נשמרה',
  saveGame: 'שמירת משחק',
  loadGame: 'טעינת משחק',
  slot: 'משבצת',
  empty: 'ריקה',
  saved: 'המשחק נשמר',
  loaded: 'המשחק נטען',
  noSave: 'אין שם שמירה',
  deleteSlot: 'מחיקה',

  potionRoom: 'חדר השיקויים',
  loading: 'טוען את קובצי המשחק…',
  pressToBegin: 'הקישו מקש כלשהו כדי להתחיל',
  keysTitle: 'מקשים',
  keys: [
    ['חיצים / מקלדת ספרתית', 'תנועה; מקש פינתי קופץ לאותו כיוון'],
    ['Shift', 'צעידה זהירה ואחיזה בקצה'],
    ['חץ למעלה בריצה', 'קפיצת ריצה'],
    ['רווח', 'הזמן שנותר'],
    ['Esc', 'השהיה, ושוב לצעד אחד'],
    ['Ctrl+A', 'התחלת השלב מחדש'],
    ['Ctrl+R', 'חזרה למסך הפתיחה'],
    ['Ctrl+S', 'כיבוי והדלקת הקול'],
    ['Shift+L', 'דילוג על שלב'],
    ['R', 'החייאת הנסיך'],
    ['K', 'הפלת השומר'],
    ['Shift+T / Shift+S', 'כד / נקודת חיים'],
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
