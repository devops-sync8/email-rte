// Fails when any shipped file references a CDN or third-party asset host.
// Scans: files npm would publish for each package, the built demo (which
// the sample host serves), and the contents of any packed .nupkg under artifacts/.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN = /unpkg|cdnjs|jsdelivr|fonts\.googleapis|fonts\.gstatic|google\s*fonts|via\.placeholder\.com/i;

// Directories npm publishes from (the Angular package publishes its ng-packagr output).
const npmPackages = ['packages/rte', 'packages/rte-react', 'packages/rte-angular/dist'];
const dirs = ['samples/rte-demo/dist'];

const findings = [];
let scanned = 0;

function scanText(label, text) {
  scanned++;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(FORBIDDEN);
    if (m) {
      const at = Math.max(0, m.index - 40);
      findings.push(`${label}:${i + 1}: …${line.slice(at, m.index + 60)}…`);
    }
  });
}

function scanFile(file) {
  scanText(path.relative(root, file), readFileSync(file, 'latin1'));
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    statSync(p).isDirectory() ? walk(p) : scanFile(p);
  }
}

// Files npm would publish (package.json "files" + always-included files).
for (const pkg of npmPackages) {
  const dir = path.join(root, pkg);
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8' });
  const [{ files }] = JSON.parse(out);
  if (!files.some((f) => f.path.startsWith('dist/') || f.path.startsWith('fesm2022/'))) {
    console.error(`${pkg}: dist/ is missing; build before running the CDN check.`);
    process.exit(1);
  }
  for (const f of files) scanFile(path.join(dir, f.path));
}

for (const d of dirs) {
  const dir = path.join(root, d);
  if (!existsSync(dir)) {
    console.error(`${d} is missing; build the demo before running the CDN check.`);
    process.exit(1);
  }
  walk(dir);
}

// Minimal zip reader for .nupkg files (deflate/stored entries).
function* zipEntries(buf) {
  let off = 0;
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const csize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.toString('utf8', off + 30, off + 30 + nameLen);
    const start = off + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + csize);
    yield [name, method === 8 ? inflateRawSync(data) : data];
    off = start + csize;
  }
}

const artifacts = path.join(root, 'artifacts');
if (existsSync(artifacts)) {
  for (const f of readdirSync(artifacts).filter((f) => f.endsWith('.nupkg'))) {
    for (const [name, data] of zipEntries(readFileSync(path.join(artifacts, f)))) {
      scanText(`artifacts/${f}!${name}`, data.toString('latin1'));
    }
  }
}

if (findings.length) {
  console.error(`CDN check failed: ${findings.length} reference(s) to forbidden hosts:\n` + findings.join('\n'));
  process.exit(1);
}
console.log(`CDN check passed: ${scanned} shipped files scanned, no forbidden host references.`);
