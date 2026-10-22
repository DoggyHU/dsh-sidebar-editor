/**
 * The official `CODE_HIGHLIGHT_EXTENSIONS` table, copied verbatim.
 *
 * The shipped "Code" renderer claims exactly this set (it re-exports the table
 * from `@deepseek-ai/dsh-util-code-language`), and starting from the same list is
 * what keeps the two code entries side by side in one dropdown instead of one
 * hiding the other. It is split below into the suffixes that open editable by
 * default and the handful the product renders itself.
 *
 * Markdown is in the list on purpose: `.md` then offers both this view and the
 * rich text one, which is how "switch to source and fix what the serializer
 * normalised" stays possible.
 *
 * A suffix here may have no CodeMirror grammar; those files open as plain
 * editable text (see `languages.js`, which is the only place that knows).
 */
export const CODE_EXTENSIONS = [
  'ts', 'tsx', 'mts', 'cts',
  'js', 'jsx', 'mjs', 'cjs',
  'sh', 'bash', 'zsh', 'fish',
  'json', 'jsonc', 'jsonl', 'ndjson', 'ipynb',
  'csv',
  'py', 'pyw', 'pyi',
  'rb', 'rake', 'gemspec',
  'go', 'rs', 'java',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hh', 'hpp', 'hxx',
  'cs', 'kt', 'kts', 'swift', 'php',
  'yaml', 'yml', 'toml',
  'ini', 'conf', 'cfg', 'properties', 'env',
  'log', 'diff', 'patch', 'http',
  'md', 'markdown', 'mdx', 'rst',
  'tex', 'sty', 'cls', 'bib', 'adoc',
  'html', 'htm', 'xhtml', 'css', 'scss', 'less',
  'sql', 'xml', 'xsd', 'xsl', 'xslt', 'plist', 'svg',
  'lua', 'bat', 'cmd', 'ps1', 'psm1', 'psd1',
  'r', 'jl', 'dart', 'scala',
  'clj', 'cljs', 'edn', 'erl', 'hrl', 'ex', 'exs',
  'hs', 'fs', 'fsi', 'fsx', 'vb', 'pl', 'pm',
  'v', 'sv', 'svh', 'graphql', 'gql', 'proto',
  'tf', 'tfvars', 'hcl', 'nix', 'vue', 'svelte',
  'makefile', 'mk', 'cmake', 'gradle', 'groovy',
];

/**
 * Suffixes this plugin's *second* code entry claims at the shipped band.
 *
 * The product renders these itself and does it better than a text editor can: an
 * `.svg` is an image, `.html` is a page, `.csv` is a spreadsheet. Claiming them at
 * the same band as the shipped renderers keeps them one dropdown entry away
 * without changing what opens by default — the same arrangement the retired
 * `dsh-sidebar-editor` used for its whole table.
 *
 * They cannot simply live in the list above: one definition has one band, and the
 * list above deliberately sits *above* `builtin` so that source files open
 * editable.
 */
export const PRODUCT_RENDERED_EXTENSIONS = ['html', 'htm', 'svg', 'csv'];

/** Fast membership test for the product-rendered split. */
const PRODUCT_RENDERED = new Set(PRODUCT_RENDERED_EXTENSIONS);

/**
 * Suffixes the preferred code entry claims: the whole table minus the ones the
 * product renders itself. Two entries claiming one suffix would show up twice in
 * the dropdown, so the two lists must stay disjoint — `tests/browser.mjs` asserts it.
 */
export const SOURCE_EXTENSIONS = CODE_EXTENSIONS.filter((suffix) => PRODUCT_RENDERED.has(suffix) !== true);
