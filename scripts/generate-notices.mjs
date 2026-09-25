// Generates THIRD_PARTY_NOTICES.md from the installed dependency trees.
//   node scripts/generate-notices.mjs           write the file
//   node scripts/generate-notices.mjs --fetch   also fetch missing license texts from upstream (at the exact commit)
//   node scripts/generate-notices.mjs --check   fail if the committed file is out of date
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { root, collectNpm, collectNuget } from './lib/licenses.mjs';
import { evaluate, verifyCore } from './check-licenses.mjs';

const args = new Set(process.argv.slice(2));
const target = path.join(root, 'THIRD_PARTY_NOTICES.md');

const npm = collectNpm();
const nuget = await collectNuget({ fetchMissing: args.has('--fetch') });
const all = [...npm, ...nuget];

const problems = evaluate(all);
if (problems.length) {
  console.error(`Cannot generate notices:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const anchor = (e) => `${e.ecosystem}-${e.name}-${e.version}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
const table = (entries) =>
  [
    '| Package | Version | License | Copyright holder | Repository |',
    '| --- | --- | --- | --- | --- |',
    ...entries.map(
      (e) =>
        `| [${cell(e.name)}](#${anchor(e)}) | ${e.version} | ${cell(e.license)} | ${cell(e.copyright)} | ${e.repository ? `<${e.repository}>` : '—'} |`,
    ),
  ].join('\n');

const fence = (text) => {
  let f = '```';
  while (text.includes(f)) f += '`';
  return `${f}text\n${text.replace(/\s+$/, '')}\n${f}`;
};

const core = verifyCore(all);
const md = `# Third-party notices

This project (email-rte, BSD-3-Clause, see [LICENSE](LICENSE)) ships or bundles
the third-party software listed below. This file is generated from the installed
dependency trees by \`npm run license:notices\`; do not edit it by hand.

- **npm**: \`npx license-checker --production\` over a production-only install of
  the runtime dependencies of \`@sync8/email-rte\`, \`@sync8/email-rte-react\` and
  \`@sync8/email-rte-angular\` (host-provided React and Angular excluded).
- **NuGet**: \`dotnet list package --include-transitive\` for \`Sync8.EmailRte\` and the
  sample host (test projects excluded).

License texts come from the installed packages. Where a package does not include
one, the text is taken from the package's upstream repository at the exact
commit recorded in its metadata, or as otherwise stated per package; these
texts are kept in [third_party/license-texts](third_party/license-texts).

## Verified core licenses

| Package | Version checked | Expected | Result |
| --- | --- | --- | --- |
${core.map((c) => `| ${c.name} (${c.ecosystem}) | ${c.version} | ${c.expect} | ${c.ok ? 'Verified' : 'MISMATCH'}: ${cell(c.detail)} |`).join('\n')}

## npm packages (${npm.length})

${table(npm)}

## NuGet packages (${nuget.length})

${table(nuget)}

## License texts

${all
  .map(
    (e) => `### ${e.name} ${e.version}<a id="${anchor(e)}"></a>

- Ecosystem: ${e.ecosystem}
- License: ${e.license}
- Copyright: ${e.copyright}
- Repository: ${e.repository || 'not stated'}
- License text source: ${e.licenseTextSource}

${fence(e.licenseText)}
`,
  )
  .join('\n')}`;

if (args.has('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current !== md) {
    console.error('THIRD_PARTY_NOTICES.md is out of date; run `npm run license:notices` and commit the result.');
    // Show where it differs, so a CI failure can be understood without reproducing it.
    const [have, want] = [current.split('\n'), md.split('\n')];
    const shown = [];
    for (let i = 0; i < Math.max(have.length, want.length) && shown.length < 20; i++) {
      if (have[i] !== want[i]) shown.push(`line ${i + 1}:\n  committed: ${have[i] ?? '(none)'}\n  generated: ${want[i] ?? '(none)'}`);
    }
    console.error(shown.join('\n'));
    process.exit(1);
  }
  console.log(`THIRD_PARTY_NOTICES.md is up to date (${all.length} packages).`);
} else {
  writeFileSync(target, md);
  console.log(`Wrote THIRD_PARTY_NOTICES.md (${npm.length} npm + ${nuget.length} NuGet packages).`);
}
