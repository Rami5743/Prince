/**
 * A recording of what was pressed, and what the game did with it.
 *
 * The point of these is to get a real session out of a real browser and
 * into a test. The game is deterministic: given the same level and the
 * same keys on the same ticks it does the same thing every time, so a
 * recording of the input is enough to replay a session exactly, and the
 * states recorded alongside it are there to prove the replay matches what
 * the player actually saw.
 *
 * The raw key events are kept too, with the tick each landed on. They are
 * not needed to replay anything; they are for working out what the page
 * did with a press -- whether it was acted on late, or dropped.
 */
import type { Controls } from './control-latch.ts';

export const RECORDING_FORMAT = 'prince-input-recording';
export const RECORDING_VERSION = 1;

export interface RecordedEvent {
  /** Milliseconds since the recording started. */
  ms: number;
  /** The tick that was current when it arrived. */
  tick: number;
  type: 'down' | 'up';
  /** The key's `code`, as the browser gives it. */
  key: string;
}

export interface RecordedState {
  tick: number;
  frame: number;
  room: number;
  x: number;
  y: number;
  hitPoints: number;
}

export interface Recording {
  format: typeof RECORDING_FORMAT;
  version: number;
  recordedAt: string;
  level: number;
  ticksPerSecond: number;
  /** Run-length input, one entry per tick; see `encodeTimeline`. */
  timeline: string;
  events: RecordedEvent[];
  states: RecordedState[];
}

/**
 * One tick's keys as a short token: `l`/`r`, `u`/`d` and `s` for shift, in
 * that order, or `.` for nothing. Runs of the same token are written as a
 * count and the token, comma separated -- `12.,30r,6us`.
 */
export function tokenOf(c: Controls): string {
  const s = (c.x < 0 ? 'l' : c.x > 0 ? 'r' : '')
    + (c.y < 0 ? 'u' : c.y > 0 ? 'd' : '')
    + (c.shift ? 's' : '');
  return s === '' ? '.' : s;
}

export function controlsOf(token: string): Controls {
  if (!/^(?:\.|[lr]?[ud]?s?)$/.test(token) || token === '') {
    throw new Error(`bad input token ${JSON.stringify(token)}`);
  }
  return {
    x: token.includes('l') ? -1 : token.includes('r') ? 1 : 0,
    y: token.includes('u') ? -1 : token.includes('d') ? 1 : 0,
    shift: token.includes('s'),
  };
}

export function encodeTimeline(ticks: readonly Controls[]): string {
  const out: string[] = [];
  let token = '';
  let count = 0;
  for (const c of ticks) {
    const t = tokenOf(c);
    if (t === token) { count++; continue; }
    if (count) out.push(`${count}${token}`);
    token = t;
    count = 1;
  }
  if (count) out.push(`${count}${token}`);
  return out.join(',');
}

export function decodeTimeline(spec: string): Controls[] {
  const out: Controls[] = [];
  for (const part of spec.split(',')) {
    const item = part.trim();
    if (!item) continue;
    const m = /^(\d+)(.*)$/.exec(item);
    if (!m) throw new Error(`bad timeline item ${JSON.stringify(part)}`);
    const c = controlsOf(m[2] === '' ? '.' : m[2]);
    for (let i = 0; i < Number(m[1]); i++) out.push({ ...c });
  }
  return out;
}

/** Read a recording, checking it is one, and give back something typed. */
export function parseRecording(text: string): Recording {
  const raw: unknown = JSON.parse(text);
  const r = raw as Partial<Recording>;
  if (r.format !== RECORDING_FORMAT) {
    throw new Error(`not a ${RECORDING_FORMAT}: ${String(r.format)}`);
  }
  if (typeof r.level !== 'number' || typeof r.timeline !== 'string') {
    throw new Error('recording is missing its level or its timeline');
  }
  return {
    format: RECORDING_FORMAT,
    version: r.version ?? 0,
    recordedAt: r.recordedAt ?? '',
    level: r.level,
    ticksPerSecond: r.ticksPerSecond ?? 12,
    timeline: r.timeline,
    events: r.events ?? [],
    states: r.states ?? [],
  };
}
