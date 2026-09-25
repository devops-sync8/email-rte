// Collects third-party dependencies of everything this repo ships, with their
// licenses and verbatim license texts, from the *installed* dependency trees:
//   npm:   `npx license-checker --production` over a production-only install of
//          the runtime dependencies of the shipped packages and the sample app
//   NuGet: `dotnet list package --include-transitive` for the shipped .NET
//          projects, reading nuspecs and license files from the NuGet cache.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Packages whose runtime dependencies end up in something we ship. */
const NPM_RUNTIME_SOURCES = [
  'packages/rte',
  'packages/rte-react',
  'packages/rte-angular',
];
/** Framework peer dependencies the host app provides and we never bundle. */
const NPM_HOST_PROVIDED = new Set(['react', 'react-dom', '@angular/core', '@angular/forms']);
/** Shipped .NET projects (tests excluded). */
const DOTNET_PROJECTS = ['packages/dotnet/src/Sync8.EmailRte/Sync8.EmailRte.csproj', 'samples/host/EmailRte.Sample.Host.csproj'];
/** Verbatim license texts fetched from upstream repos for packages that do not include one. */
export const LICENSE_CACHE = path.join(root, 'third_party/license-texts');

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const cachePath = (id, version) => path.join(LICENSE_CACHE, `${id}@${version}.txt`);
const SOURCES_FILE = path.join(LICENSE_CACHE, 'sources.json');

/** Reviewed license text stored in third_party/license-texts, with its provenance. */
function cachedText(key) {
  const at = key.lastIndexOf('@');
  const file = cachePath(key.slice(0, at), key.slice(at + 1));
  if (!existsSync(file)) return { text: null, source: null };
  const sources = existsSync(SOURCES_FILE) ? readJson(SOURCES_FILE) : {};
  return {
    text: readFileSync(file, 'utf8'),
    source: `${sources[key] ?? 'upstream repository'} (cached in third_party/license-texts)`,
  };
}

// ---------------------------------------------------------------- policy ---

const ALLOWED = new Set([
  'MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'CC0-1.0',
  'Unlicense', 'BlueOak-1.0.0', 'Zlib', 'Python-2.0', 'CC-BY-3.0', 'CC-BY-4.0',
]);
const COPYLEFT = /\b(A|L)?GPL|SSPL/i;
const DENIED_PACKAGES = [/^ckeditor/i, /^@ckeditor\//i];

/**
 * Evaluate an SPDX expression. `OR` passes when any alternative passes;
 * `AND` requires every part to pass. Returns { ok, reason }.
 */
export function evaluateLicense(name, expression) {
  if (DENIED_PACKAGES.some((re) => re.test(name))) return { ok: false, reason: 'package is on the deny list' };
  if (!expression || /^(UNKNOWN|UNLICENSED|Custom)/i.test(expression)) {
    return { ok: false, reason: `unknown license (${expression || 'none'})` };
  }
  const expr = expression.replace(/[()]/g, ' ').replace(/\*$/, '').trim();
  const alternatives = expr.split(/\s+OR\s+/i).map((alt) => alt.split(/\s+AND\s+/i).map((t) => t.trim()));
  if (alternatives.some((parts) => parts.every((p) => ALLOWED.has(p)))) return { ok: true };
  if (COPYLEFT.test(expr)) return { ok: false, reason: `copyleft license (${expression})` };
  return { ok: false, reason: `license not on the allow list (${expression})` };
}

// --------------------------------------------------------------- helpers ---

/** Copyright lines from a license text; falls back to `fallback`. */
export function copyrightFrom(text, fallback) {
  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(copyright\b|\(c\)|©)/i.test(l))
    // License boilerplate that merely mentions copyright (Apache-2.0, CC0, …).
    .filter((l) => !/copyright (notice|holders?\b|owner|license|and related)|^\(c\)\s+you\b/i.test(l));
  const unique = [...new Set(lines)];
  return unique.length ? unique.join('; ') : fallback || 'Not stated in package';
}

const normalizeRepo = (url) =>
  url
    ? url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')
    : '';

const LICENSE_FILE_RE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

// ------------------------------------------------------------------- npm ---

/** A "License" section of a README, when it contains a recognisable license text. */
function readmeLicenseSection(readme) {
  const lines = readme.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s*licen[cs]e\b/i.test(l));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
  if (end < 0) end = lines.length;
  const section = lines.slice(start + 1, end).join('\n').trim();
  return guessSpdx(section) ? section : null;
}

/** License text from the installed package, its README, or the reviewed cache. */
function npmLicenseText(pkgDir, key) {
  const file = readdirSync(pkgDir).find((f) => LICENSE_FILE_RE.test(f));
  if (file) return { text: readFileSync(path.join(pkgDir, file), 'utf8'), source: `${file} in the installed npm package` };
  const readme = readdirSync(pkgDir).find((f) => /^readme(\.md|\.markdown|\.txt)?$/i.test(f));
  const section = readme && readmeLicenseSection(readFileSync(path.join(pkgDir, readme), 'utf8'));
  if (section) return { text: section, source: `"License" section of ${readme} in the installed npm package (no separate license file)` };
  return cachedText(key);
}

function npmRuntimeDependencies() {
  const workspaceNames = new Set(NPM_RUNTIME_SOURCES.map((p) => readJson(path.join(root, p, 'package.json')).name));
  const deps = new Map();
  for (const pkgDir of NPM_RUNTIME_SOURCES) {
    const pkg = readJson(path.join(root, pkgDir, 'package.json'));
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
      if (workspaceNames.has(name) || NPM_HOST_PROVIDED.has(name)) continue;
      // Pin to the version installed in this repo.
      const installed = path.join(root, 'node_modules', name, 'package.json');
      if (!existsSync(installed)) throw new Error(`${name} is not installed; run npm ci first.`);
      deps.set(name, readJson(installed).version);
    }
  }
  return deps;
}

/** Versions of every package in the repo's installed production tree. */
function installedProductionVersions() {
  const out = run('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root });
  const versions = new Map();
  const visit = (deps) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      if (info.version) versions.set(`${name}@${info.version}`, true);
      visit(info.dependencies);
    }
  };
  visit(JSON.parse(out).dependencies);
  return versions;
}

export function collectNpm() {
  const deps = npmRuntimeDependencies();
  const stage = path.join(os.tmpdir(), 'email-rte-license-stage');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  writeFileSync(
    path.join(stage, 'package.json'),
    JSON.stringify({ name: 'license-stage', version: '0.0.0', private: true, license: 'UNLICENSED', dependencies: Object.fromEntries(deps) }, null, 2),
  );
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: stage });

  const checker = path.join(root, 'node_modules/license-checker/bin/license-checker');
  const report = JSON.parse(run(process.execPath, [checker, '--production', '--json', '--start', stage]));
  const installed = installedProductionVersions();

  const entries = [];
  for (const [key, info] of Object.entries(report)) {
    const at = key.lastIndexOf('@');
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (name === 'license-stage') continue;
    const pkgDir = info.path;
    const pkgJson = readJson(path.join(pkgDir, 'package.json'));
    // Prefer an actual LICENSE file; license-checker may point at a README.
    const { text, source } = npmLicenseText(pkgDir, `${name}@${version}`);
    const author = typeof pkgJson.author === 'string' ? pkgJson.author : pkgJson.author?.name;
    entries.push({
      ecosystem: 'npm',
      name,
      version,
      license: Array.isArray(info.licenses) ? info.licenses.join(' OR ') : info.licenses,
      declaredLicense: typeof pkgJson.license === 'string' ? pkgJson.license : pkgJson.license?.type,
      repository: normalizeRepo(info.repository || pkgJson.repository?.url || pkgJson.repository),
      copyright: copyrightFrom(text, author || info.publisher),
      licenseText: text,
      licenseTextSource: source,
      matchesRepoInstall: installed.has(key),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------- NuGet ---

function nugetPackagesFolder() {
  const out = run('dotnet', ['nuget', 'locals', 'global-packages', '--list']);
  return out.split(/global-packages:\s*/)[1].trim();
}

function parseNuspec(xml) {
  const tag = (t) => xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([^<]*)</${t}>`))?.[1]?.trim();
  const license = xml.match(/<license\s+type="(\w+)"[^>]*>([^<]+)<\/license>/);
  const repo = xml.match(/<repository\s+([^>]*)\/?>/)?.[1] ?? '';
  const attr = (a) => repo.match(new RegExp(`${a}="([^"]*)"`))?.[1];
  return {
    licenseType: license?.[1],
    license: license?.[2]?.trim(),
    licenseUrl: tag('licenseUrl'),
    authors: tag('authors'),
    copyright: tag('copyright'),
    projectUrl: tag('projectUrl'),
    repositoryUrl: attr('url'),
    repositoryCommit: attr('commit'),
  };
}

export function listNugetPackages() {
  const packages = new Map();
  for (const project of DOTNET_PROJECTS) {
    const out = run('dotnet', ['list', path.join(root, project), 'package', '--include-transitive', '--format', 'json']);
    for (const p of JSON.parse(out).projects ?? []) {
      for (const fw of p.frameworks ?? []) {
        for (const pkg of [...(fw.topLevelPackages ?? []), ...(fw.transitivePackages ?? [])]) {
          packages.set(`${pkg.id}@${pkg.resolvedVersion}`, { id: pkg.id, version: pkg.resolvedVersion });
        }
      }
    }
  }
  return [...packages.values()];
}


/**
 * Candidate upstream URLs for a package's license: the exact commit recorded in
 * the nuspec, else the release tag for this exact version.
 */
function upstreamLicenseUrls(meta, version) {
  const m = (meta.repositoryUrl || meta.projectUrl || '').match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
  if (!m) return [];
  const refs = meta.repositoryCommit ? [meta.repositoryCommit] : [version, `v${version}`];
  const files = ['LICENSE', 'LICENSE.txt', 'LICENSE.TXT', 'LICENSE.md', 'License.txt', 'license.txt'];
  return refs.flatMap((ref) => files.map((f) => `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${ref}/${f}`));
}

async function fetchUpstreamLicense(meta, version) {
  for (const url of upstreamLicenseUrls(meta, version)) {
    const res = await fetch(url);
    if (res.ok) return { text: await res.text(), url };
  }
  return null;
}

export async function collectNuget({ fetchMissing = false } = {}) {
  const folder = nugetPackagesFolder();
  const sources = existsSync(SOURCES_FILE) ? readJson(SOURCES_FILE) : {};
  const entries = [];

  for (const { id, version } of listNugetPackages()) {
    const dir = path.join(folder, id.toLowerCase(), version.toLowerCase());
    const nuspecFile = readdirSync(dir).find((f) => f.endsWith('.nuspec'));
    const meta = parseNuspec(readFileSync(path.join(dir, nuspecFile), 'utf8'));

    let text = null;
    let source = null;
    const inPackage =
      meta.licenseType === 'file' ? meta.license : readdirSync(dir).find((f) => LICENSE_FILE_RE.test(f));
    if (inPackage && existsSync(path.join(dir, inPackage))) {
      text = readFileSync(path.join(dir, inPackage), 'utf8');
      source = `${inPackage} in the NuGet package`;
    } else if (existsSync(cachePath(id, version))) {
      ({ text, source } = cachedText(`${id}@${version}`));
      source = `not included in the NuGet package; from ${source}`;
    } else if (fetchMissing) {
      const fetched = await fetchUpstreamLicense(meta, version);
      if (fetched) {
        mkdirSync(LICENSE_CACHE, { recursive: true });
        writeFileSync(cachePath(id, version), fetched.text);
        sources[`${id}@${version}`] = fetched.url;
        text = fetched.text;
        source = `not included in the NuGet package; from ${fetched.url} (cached in third_party/license-texts)`;
      }
    }

    const license =
      meta.licenseType === 'expression'
        ? meta.license
        : meta.licenseType === 'file'
          ? guessSpdx(text)
          : guessSpdx(text) ?? meta.licenseUrl;

    entries.push({
      ecosystem: 'nuget',
      name: id,
      version,
      license,
      declaredLicense: meta.licenseType === 'expression' ? meta.license : meta.licenseUrl ?? meta.license,
      repository: normalizeRepo(meta.repositoryUrl || meta.projectUrl),
      copyright: copyrightFrom(text, meta.copyright && meta.copyright !== meta.license ? meta.copyright : meta.authors),
      licenseText: text,
      licenseTextSource: source,
      matchesRepoInstall: true,
    });
  }

  if (fetchMissing) writeFileSync(SOURCES_FILE, JSON.stringify(sortKeys(sources), null, 2) + '\n');
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/** Identify a license from its text, for packages that declare it only by URL or file. */
export function guessSpdx(text) {
  if (!text) return null;
  if (/Permission is hereby granted, free of charge/.test(text)) return 'MIT';
  if (/Apache License,?\s+Version 2\.0/i.test(text)) return 'Apache-2.0';
  if (/Redistribution and use in source and binary forms/.test(text)) {
    return /Neither the name|names of its\s+contributors/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  if (/GNU (LESSER|AFFERO)? ?GENERAL PUBLIC LICENSE/i.test(text)) return 'GPL-family';
  return null;
}
