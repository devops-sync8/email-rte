// License gate: fails when any shipped dependency (npm or NuGet) is
// GPL/LGPL/AGPL/SSPL, unknown, or not on the allow list, or when the core
// libraries' license files are not what we rely on.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { root, collectNpm, collectNuget, evaluateLicense, guessSpdx } from './lib/licenses.mjs';

/** Core libraries whose license files are read and verified explicitly. */
export const CORE = [
  { ecosystem: 'npm', name: 'quill', expect: 'BSD-3-Clause' },
];

export function verifyCore(entries) {
  return CORE.map((c) => {
    const e = entries.find((x) => x.ecosystem === c.ecosystem && x.name === c.name);
    if (!e) return { ...c, ok: false, detail: 'not found in the dependency tree' };
    const fromText = guessSpdx(e.licenseText);
    const ok = e.declaredLicense === c.expect && fromText === c.expect;
    return {
      ...c,
      version: e.version,
      ok,
      detail: `declared ${e.declaredLicense}; license text reads as ${fromText ?? 'unrecognised'} (${e.licenseTextSource ?? 'no text'})`,
    };
  });
}

export function evaluate(entries) {
  const problems = [];
  for (const e of entries) {
    const verdict = evaluateLicense(e.name, e.license);
    if (!verdict.ok) problems.push(`${e.ecosystem} ${e.name}@${e.version}: ${verdict.reason}`);
    if (!e.licenseText) problems.push(`${e.ecosystem} ${e.name}@${e.version}: no license text found (run: npm run license:notices -- --fetch)`);
    if (!e.matchesRepoInstall) problems.push(`${e.ecosystem} ${e.name}@${e.version}: not in the repo's installed production tree (lockfile drift?)`);
  }
  for (const c of verifyCore(entries)) {
    if (!c.ok) problems.push(`core ${c.name}: expected ${c.expect}; ${c.detail}`);
  }
  return problems;
}

// Our own packages must carry the project license too.
function checkOwnPackages() {
  const problems = [];
  for (const dir of ['packages/rte', 'packages/rte-react', 'packages/rte-angular']) {
    const pkg = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
    if (pkg.license !== 'BSD-3-Clause') problems.push(`${pkg.name}: license must be BSD-3-Clause`);
  }
  const csproj = readFileSync(path.join(root, 'packages/dotnet/src/Sync8.EmailRte/Sync8.EmailRte.csproj'), 'utf8');
  if (!csproj.includes('<PackageLicenseExpression>BSD-3-Clause</PackageLicenseExpression>')) {
    problems.push('Sync8.EmailRte.csproj: PackageLicenseExpression must be BSD-3-Clause');
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const entries = [...collectNpm(), ...(await collectNuget())];
  const problems = [...evaluate(entries), ...checkOwnPackages()];

  const byLicense = {};
  for (const e of entries) byLicense[e.license] = (byLicense[e.license] ?? 0) + 1;
  console.log(`Checked ${entries.length} shipped third-party packages:`, byLicense);
  for (const c of verifyCore(entries)) console.log(`  ${c.ok ? 'ok ' : 'BAD'} ${c.name}@${c.version ?? '?'}: ${c.detail}`);

  if (problems.length) {
    console.error(`\nLicense check failed:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('License check passed.');
}
