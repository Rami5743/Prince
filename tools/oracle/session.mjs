/**
 * A play session, written once and used for both sides of the comparison.
 *
 * The problem this solves: the original runs in real time under an emulator
 * and the port runs tick by tick, so the two cannot be driven from a shared
 * clock. What they can share is the *order* of things. A session is therefore
 * a list of phases -- "these keys are held, and this many frames are captured
 * while they are" -- which is enough to generate the emulator script on one
 * side and to drive the port on the other, with the capture order as the
 * common thread.
 *
 * Format, one directive per line:
 *
 *   level <n>        which level to play (reached with the cheat build's
 *                    Shift+L, so a high number costs a long capture)
 *   cycles <n>       emulator speed for this session; low is slow, which
 *                    puts consecutive captures a tick or two apart
 *   settle <s>       seconds to wait after the level is up, before any input
 *   phase <keys> <n> hold <keys> and take <n> captures
 *
 * <keys> is a combination of l r u d s (shift), or `-` for no key at all.
 */

/** Keys of a phase, as the port's Controls and as xdotool key names. */
function parseKeys(spec) {
  if (spec === '-') return { x: 0, y: 0, shift: false, keys: [] };
  const keys = [];
  let x = 0, y = 0, shift = false;
  for (const ch of spec) {
    if (ch === 'l') { x = -1; keys.push('Left'); }
    else if (ch === 'r') { x = 1; keys.push('Right'); }
    else if (ch === 'u') { y = -1; keys.push('Up'); }
    else if (ch === 'd') { y = 1; keys.push('Down'); }
    else if (ch === 's') { shift = true; keys.push('shift'); }
    else throw new Error(`unknown key ${JSON.stringify(ch)} in phase ${JSON.stringify(spec)}`);
  }
  return { x, y, shift, keys };
}

export function parseSession(text, name = 'session') {
  const session = { name, level: 1, cycles: 400, settle: 40, phases: [] };
  let n = 0;
  for (const raw of text.split('\n')) {
    n++;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [op, ...rest] = line.split(/\s+/);
    if (op === 'level') session.level = Number(rest[0]);
    else if (op === 'cycles') session.cycles = Number(rest[0]);
    else if (op === 'settle') session.settle = Number(rest[0]);
    else if (op === 'phase') {
      const shots = Number(rest[1]);
      if (!Number.isInteger(shots) || shots < 1) {
        throw new Error(`${name}:${n}: phase needs a positive capture count`);
      }
      session.phases.push({ spec: rest[0], ...parseKeys(rest[0]), shots });
    } else throw new Error(`${name}:${n}: unknown directive ${JSON.stringify(op)}`);
  }
  if (!session.phases.length) throw new Error(`${name}: no phases`);
  return session;
}

/** Capture names, in order: the common index between the two sides. */
export function shotNames(session) {
  const out = [];
  let i = 0;
  for (const phase of session.phases) {
    for (let k = 0; k < phase.shots; k++) out.push(`s${String(i++).padStart(3, '0')}`);
  }
  return out;
}

/** Which phase each capture belongs to. */
export function shotPhases(session) {
  const out = [];
  session.phases.forEach((phase, pi) => {
    for (let k = 0; k < phase.shots; k++) out.push(pi);
  });
  return out;
}

/**
 * The emulator script. Shift+L is the cheat build's "skip to the next
 * level"; each skip plays a cut-scene, hence the long wait after it.
 */
export function toDosboxScript(session) {
  const out = [
    `# generated from ${session.name}.session -- do not edit by hand`,
    `# run with --cycles ${session.cycles}`,
    'wait 25',
    'key Return',
    'wait 20',
  ];
  for (let l = 1; l < session.level; l++) {
    out.push('key shift+l', 'wait 70');
  }
  out.push(`wait ${session.settle}`);
  let held = [];
  let i = 0;
  for (const phase of session.phases) {
    for (const k of held) if (!phase.keys.includes(k)) out.push(`keyup ${k}`);
    for (const k of phase.keys) if (!held.includes(k)) out.push(`keydown ${k}`);
    held = phase.keys;
    for (let k = 0; k < phase.shots; k++) {
      out.push(`shot s${String(i++).padStart(3, '0')}`);
    }
  }
  for (const k of held) out.push(`keyup ${k}`);
  return out.join('\n') + '\n';
}
