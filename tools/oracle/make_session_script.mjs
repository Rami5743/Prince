#!/usr/bin/env node
/**
 * Turn a .session file into an emulator script.
 *
 *   node tools/oracle/make_session_script.mjs tools/oracle/sessions/x.session
 *
 * Prints the command to capture it, so the two cannot drift apart.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseSession, toDosboxScript } from './session.mjs';

const src = process.argv[2];
if (!src) {
  console.error('usage: make_session_script.mjs <file.session> [outdir]');
  process.exit(2);
}
const name = basename(src).replace(/\.session$/, '');
const session = parseSession(readFileSync(src, 'utf8'), name);
const outdir = process.argv[3] ?? 'tools/oracle/scripts';
mkdirSync(outdir, { recursive: true });
const dest = join(outdir, `session-${name}.txt`);
writeFileSync(dest, toDosboxScript(session));
const shots = session.phases.reduce((a, p) => a + p.shots, 0);
console.error(`${dest}: level ${session.level}, ${session.phases.length} phases, ${shots} captures`);
console.log(`python3 tools/oracle/dosbox_oracle.py --script ${dest} \\
    --cycles ${session.cycles} --out tests/golden/session-${name}`);
