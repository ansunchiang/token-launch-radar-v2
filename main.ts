import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const { buildRadar } = require('./dashboard/model.js');

function option(name: string, fallback: string): string {
  const flag = '--' + name;
  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(flag + ' requires a path');
    return value;
  }
  return process.argv.find((arg) => arg.startsWith(flag + '='))?.slice(flag.length + 1) ?? fallback;
}

function run(): void {
  const input = option('input', '/input');
  const snapshot = JSON.parse(readFileSync(extname(input) === '.json' ? input : join(input, 'snapshot.json'), 'utf8'));
  const output = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const radar = buildRadar(snapshot);
  const board = { rows: radar.rows };

  if (board.rows.length < 100 || board.rows.length > 4000) throw new Error('Ranked row count is outside the gate limits');
  const bySlug = new Map(board.rows.map((row) => [row.slug, row]));
  if (bySlug.size !== board.rows.length || snapshot.watchlist.some((slug: string) => !bySlug.has(slug))) {
    throw new Error('Ranked board contains duplicate slugs or omits a watchlist protocol');
  }
  mkdirSync(output, { recursive: true });
  for (const folder of ['dashboard', 'screenshots']) {
    cpSync(join(root, folder), join(output, folder), { recursive: true, filter: (p) => !basename(p).startsWith('.') });
  }
  writeFileSync(join(output, 'board.json'), JSON.stringify(board) + '\n');
  writeFileSync(join(output, 'data.js'), 'globalThis.RADAR_INPUT = ' + JSON.stringify({ snapshot, board }) + ';\n');

  const dossier = buildDossier(output, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  if (dossier.byteLength > 1_572_864) throw new Error('Dossier exceeds 1.5 MiB');
  writeFileSync(join(output, 'dossier.json'), dossier);
  console.log('Launch Ledger wrote ' + board.rows.length + ' ranked rows and a ' + dossier.byteLength + '-byte dossier to ' + output);
}

try {
  run();
} catch (error) {
  console.error('Launch Ledger:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
