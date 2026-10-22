/**
 * Suffix to CodeMirror language resolution.
 *
 * Phase 0 ships a curated set (~20 grammars, the user-approved scope). Anything
 * outside it opens as plain editable text: the editor still works, only the
 * syntax colouring is missing. Suffixes are matched case-insensitively against
 * the last dot of the final path segment.
 *
 * Every grammar is a static import on purpose. A third-party client bundle is a
 * single classic script with no dynamic-import hook, so `import()`-based lazy
 * grammar loading (what `@codemirror/language-data` does) cannot work here.
 */
import { StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { xml } from '@codemirror/lang-xml';
import { php } from '@codemirror/lang-php';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { csharp, kotlin, scala, dart } from '@codemirror/legacy-modes/mode/clike';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { perl } from '@codemirror/legacy-modes/mode/perl';

/** Wrap a legacy stream parser as a language extension. */
const stream = (mode) => StreamLanguage.define(mode);

/** Suffix to language factory; the factory runs once per suffix and is cached. */
const FACTORIES = {
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  json: () => json(),
  jsonc: () => json(),
  jsonl: () => json(),
  ndjson: () => json(),
  ipynb: () => json(),
  html: () => html(),
  htm: () => html(),
  xhtml: () => html(),
  vue: () => html(),
  svelte: () => html(),
  css: () => css(),
  scss: () => css(),
  less: () => css(),
  md: () => markdown({ codeLanguages: languageForInfo }),
  markdown: () => markdown({ codeLanguages: languageForInfo }),
  mdx: () => markdown({ codeLanguages: languageForInfo }),
  py: () => python(),
  pyw: () => python(),
  pyi: () => python(),
  rs: () => rust(),
  go: () => go(),
  java: () => java(),
  c: () => cpp(),
  h: () => cpp(),
  cc: () => cpp(),
  cpp: () => cpp(),
  cxx: () => cpp(),
  hh: () => cpp(),
  hpp: () => cpp(),
  hxx: () => cpp(),
  sql: () => sql(),
  yaml: () => yaml(),
  yml: () => yaml(),
  xml: () => xml(),
  xsd: () => xml(),
  xsl: () => xml(),
  xslt: () => xml(),
  plist: () => xml(),
  svg: () => xml(),
  php: () => php(),
  sh: () => stream(shell),
  bash: () => stream(shell),
  zsh: () => stream(shell),
  fish: () => stream(shell),
  env: () => stream(properties),
  ini: () => stream(properties),
  conf: () => stream(properties),
  cfg: () => stream(properties),
  properties: () => stream(properties),
  toml: () => stream(properties),
  ps1: () => stream(powerShell),
  psm1: () => stream(powerShell),
  psd1: () => stream(powerShell),
  bat: () => stream(powerShell),
  cmd: () => stream(powerShell),
  rb: () => stream(ruby),
  rake: () => stream(ruby),
  gemspec: () => stream(ruby),
  lua: () => stream(lua),
  cs: () => stream(csharp),
  kt: () => stream(kotlin),
  kts: () => stream(kotlin),
  swift: () => stream(swift),
  scala: () => stream(scala),
  dart: () => stream(dart),
  pl: () => stream(perl),
  pm: () => stream(perl),
  diff: () => stream(diff),
  patch: () => stream(diff),
};

/** Cached language extensions, keyed by suffix. */
const CACHE = new Map();

/**
 * The lowercase suffix of a path or filename.
 * @param path - decoded path or bare filename.
 * @returns the suffix without a leading dot, or `undefined` when there is none.
 */
export function suffixOf(path) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? undefined : base.slice(dot + 1).toLowerCase();
}

/**
 * The CodeMirror language for a path, if this build has a grammar for it.
 * @param path - decoded path or bare filename.
 * @returns a language extension, or `undefined` for plain text.
 */
export function languageForPath(path) {
  const suffix = suffixOf(path);
  if (suffix === undefined) return undefined;
  if (CACHE.has(suffix)) return CACHE.get(suffix);
  const factory = FACTORIES[suffix];
  let language;
  if (factory !== undefined) {
    try {
      language = factory();
    } catch {
      language = undefined;
    }
  }
  CACHE.set(suffix, language);
  return language;
}

/** Common fence info strings that are not a file suffix. */
const INFO_ALIASES = {
  javascript: 'js',
  typescript: 'ts',
  node: 'js',
  python: 'py',
  python3: 'py',
  shell: 'sh',
  console: 'sh',
  zsh: 'sh',
  bash: 'sh',
  yml: 'yaml',
  jsonc: 'json',
  markdown: 'md',
  html5: 'html',
  cplusplus: 'cpp',
  'c++': 'cpp',
  golang: 'go',
  rust: 'rs',
  ruby: 'rb',
  powershell: 'ps1',
  text: '',
  plaintext: '',
};

/**
 * The language a fenced code block names, for Markdown fences.
 *
 * `@codemirror/lang-markdown` parses fence contents with whatever language the info
 * string names, so a fenced block colours like the file it quotes. Unknown info
 * strings fall back to unhighlighted text rather than failing the parse.
 * @param info - the fence's info string, e.g. `js`, `ts`, `python 3`.
 * @returns a CodeMirror language, or null for plain text.
 */
export function languageForInfo(info) {
  const token = String(info ?? '')
    .trim()
    .split(/[\s:]/u)[0]
    .toLowerCase();
  if (token === '') return null;
  const suffix = token in INFO_ALIASES ? INFO_ALIASES[token] : token;
  if (suffix === '') return null;
  const support = languageForPath(`fence.${suffix}`);
  return support?.language ?? null;
}
