// Copies the version Changesets assigned to packages/dotnet/package.json into
// the NuGet package's <Version>.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(root, 'packages/dotnet/package.json'), 'utf8'));
const csproj = path.join(root, 'packages/dotnet/src/Sync8.EmailRte/Sync8.EmailRte.csproj');
const xml = readFileSync(csproj, 'utf8');
const next = xml.replace(/<Version>[^<]*<\/Version>/, `<Version>${version}</Version>`);
if (next !== xml) writeFileSync(csproj, next);
console.log(`Sync8.EmailRte.csproj version: ${version}`);
