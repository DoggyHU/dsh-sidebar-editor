/**
 * The editor's stylesheet.
 *
 * Three layers, in this order:
 *
 *  1. ProseMirror's structural rules. A contenteditable needs `position: relative`
 *     on the editing host (gap cursor, selected-node outline), `pre-wrap` so
 *     newlines survive, and the selected-node/gap-cursor rules, or dropping the
 *     caret between two blocks looks like the plugin is broken.
 *  2. The document's own typography, which is what "看着舒服" means here: one
 *     reading column, the same design tokens the shipped preview uses, and sizes
 *     tuned for a sidebar rather than a full page.
 *  3. This plugin's chrome: the notice strip and the status foot.
 *
 * The tokens are the app's own (`--dsw-alias-*`), each with a literal fallback so
 * the editor is still legible if a token is renamed by a future build.
 */

/**
 * Document-level CSS variables this plugin sets on its own root.
 *
 * They have to live inside a rule: custom properties at the top level of a
 * stylesheet are not a rule, and a stylesheet that opens with one is dropped
 * wholesale — every `var(--dsh-mk-*)` below then resolves to nothing and the
 * editor loses its borders and code-block background with no error anywhere.
 */
const VARIABLES = `
  .dsh-mk-root {
    --dsh-mk-text: var(--dsw-alias-label-primary, #1f2328);
    --dsh-mk-dim: var(--dsw-alias-label-secondary, #59636e);
    --dsh-mk-faint: var(--dsw-alias-label-tertiary, #818b98);
    --dsh-mk-bg: var(--dsw-alias-bg-document-preview, #ffffff);
    --dsh-mk-border: var(--dsw-alias-border-l2, rgba(31, 35, 40, 0.12));
    --dsh-mk-rule: var(--dsw-alias-border-l2, rgba(31, 35, 40, 0.2));
    --dsh-mk-hover: var(--dsw-alias-interactive-bg-hover, rgba(31, 35, 40, 0.06));
    --dsh-mk-active: var(--dsw-alias-interactive-bg-active, rgba(31, 35, 40, 0.1));
    --dsh-mk-layer: var(--dsw-alias-bg-layer-2, #f6f8fa);
    --dsh-mk-selection: var(--dsw-alias-bg-document-selection, rgba(84, 174, 255, 0.28));
    --dsh-mk-error: var(--dsw-alias-state-error-primary, #cf222e);
    --dsh-mk-warn: var(--dsw-alias-state-warn-secondary, #9a6700);
    --dsh-mk-mono: var(--ds-font-family-code, var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace));
  }
`;

/** ProseMirror's own structural rules; the editor misbehaves without them. */
const STRUCTURAL = `
  .dsh-mk-prose { position: relative; outline: none; }
  .dsh-mk-prose.ProseMirror { word-wrap: break-word; white-space: pre-wrap; }
  .dsh-mk-prose.ProseMirror pre { white-space: pre-wrap; }
  .dsh-mk-prose.ProseMirror li { position: relative; }
  .dsh-mk-nowrap .dsh-mk-prose.ProseMirror { white-space: pre; }
  .dsh-mk-prose.ProseMirror-hideselection *::selection { background: transparent; }
  .dsh-mk-prose.ProseMirror-hideselection { caret-color: transparent; }
  .dsh-mk-prose.ProseMirror-selectednode { outline: 2px solid var(--dsh-mk-selection); }
  .dsh-mk-prose li.ProseMirror-selectednode { outline: none; }
  .dsh-mk-prose li.ProseMirror-selectednode:after {
    content: ''; position: absolute; left: -28px; right: -2px; top: -2px; bottom: -2px;
    border: 2px solid var(--dsh-mk-selection); pointer-events: none;
  }
  .dsh-mk-prose img.ProseMirror-selectednode { border-radius: 3px; }
  .dsh-mk-prose [contenteditable="false"] { white-space: normal; }
  .dsh-mk-prose [contenteditable="false"] [contenteditable="true"] { white-space: pre-wrap; }
  .dsh-mk-prose .ProseMirror-gapcursor { display: none; pointer-events: none; position: absolute; }
  .dsh-mk-prose .ProseMirror-gapcursor:after {
    content: ''; display: block; position: absolute; top: -2px; width: 20px;
    border-top: 1px solid var(--dsh-mk-text);
    animation: dsh-mk-caret-blink 1.1s steps(2, start) infinite;
  }
  @keyframes dsh-mk-caret-blink { to { visibility: hidden; } }
  .dsh-mk-prose.ProseMirror-focused .ProseMirror-gapcursor { display: block; }
`;

/** The document's typography. */
const TYPOGRAPHY = `
  .dsh-mk-surface {
    color: var(--dsh-mk-text);
    font-size: 14px;
    line-height: 1.72;
    font-family: inherit;
    letter-spacing: 0.005em;
    -webkit-font-smoothing: antialiased;
  }
  .dsh-mk-surface ::selection { background: var(--dsh-mk-selection); }

  .dsh-mk-surface > * + * { margin-top: 0.72em; }
  .dsh-mk-surface p { margin: 0; }
  .dsh-mk-surface p + p { margin-top: 0.72em; }

  .dsh-mk-surface h1, .dsh-mk-surface h2, .dsh-mk-surface h3,
  .dsh-mk-surface h4, .dsh-mk-surface h5, .dsh-mk-surface h6 {
    margin: 1.5em 0 0.62em; font-weight: 600; line-height: 1.32; letter-spacing: -0.005em;
  }
  .dsh-mk-surface h1 { font-size: 1.62em; }
  .dsh-mk-surface h2 { font-size: 1.32em; }
  .dsh-mk-surface h3 { font-size: 1.14em; }
  .dsh-mk-surface h4 { font-size: 1em; }
  .dsh-mk-surface h5 { font-size: 0.94em; }
  .dsh-mk-surface h6 { font-size: 0.88em; color: var(--dsh-mk-dim); }
  .dsh-mk-surface > h1:first-child, .dsh-mk-surface > h2:first-child,
  .dsh-mk-surface > h3:first-child { margin-top: 0; }

  .dsh-mk-surface ul, .dsh-mk-surface ol { margin: 0; padding-left: 1.5em; }
  .dsh-mk-surface li > * + * { margin-top: 0.28em; }
  .dsh-mk-surface li + li { margin-top: 0.28em; }
  .dsh-mk-surface ul ul, .dsh-mk-surface ul ol, .dsh-mk-surface ol ul, .dsh-mk-surface ol ol { margin-top: 0.28em; }
  .dsh-mk-surface li p { margin: 0; }

  .dsh-mk-surface blockquote {
    margin: 0; padding: 0.1em 0 0.1em 0.9em;
    border-left: 3px solid var(--dsh-mk-faint);
    color: var(--dsh-mk-dim);
  }
  .dsh-mk-surface blockquote > * + * { margin-top: 0.6em; }

  .dsh-mk-surface hr { border: none; border-top: 1px solid var(--dsh-mk-rule); margin: 1.6em 0; }
  .dsh-mk-surface a { color: var(--dsw-alias-state-info-primary, #0969da); text-decoration: none; }
  .dsh-mk-surface a:hover { text-decoration: underline; }

  .dsh-mk-surface code {
    font-family: var(--dsh-mk-mono); font-size: 0.88em;
    padding: 0.14em 0.36em; border-radius: 4px;
    background: var(--dsh-mk-layer); border: 1px solid var(--dsh-mk-border);
  }
  .dsh-mk-surface pre {
    margin: 0; padding: 12px 14px; overflow-x: auto;
    background: var(--dsh-mk-layer); border: 1px solid var(--dsh-mk-rule); border-radius: 8px;
    font-family: var(--dsh-mk-mono); font-size: 0.86em; line-height: 1.6;
  }
  .dsh-mk-surface pre code { padding: 0; border: none; background: none; font-size: inherit; }

  .dsh-mk-surface img { max-width: 100%; height: auto; border-radius: 6px; }

  /* GFM tables: the wrapper scrolls, the table keeps its borders and hugs its
     content instead of stretching to the reading column. */
  .dsh-mk-surface .tableWrapper { overflow-x: auto; margin: 0; }
  .dsh-mk-surface table {
    border-collapse: collapse; table-layout: auto; width: auto; min-width: 40%; margin: 0;
    font-size: 0.94em;
  }
  .dsh-mk-surface th, .dsh-mk-surface td {
    border: 1px solid var(--dsh-mk-rule); padding: 0.42em 0.7em; vertical-align: top;
    position: relative; min-width: 3.5em;
  }
  .dsh-mk-surface th { background: var(--dsh-mk-layer); font-weight: 600; text-align: left; }
  .dsh-mk-surface .selectedCell:after {
    content: ''; position: absolute; inset: 0; background: var(--dsh-mk-selection); pointer-events: none;
  }
  .dsh-mk-surface .column-resize-handle {
    position: absolute; right: -2px; top: 0; bottom: -2px; width: 4px;
    background: var(--dsh-mk-selection); pointer-events: none;
  }
  .dsh-mk-surface .resize-cursor { cursor: col-resize; }

  /* GFM task lists. The schema renders an li[data-item-type="task"] with a
     data-checked attribute rather than an <input>, so the box is drawn here
     instead of by a node view. The box hangs off the item's first paragraph: on the
     li itself it would sit on its own line, because the paragraph after it is a
     block. */
  .dsh-mk-surface li[data-item-type="task"] { list-style: none; }
  .dsh-mk-surface li[data-item-type="task"] > p::before {
    content: ''; display: inline-block; box-sizing: border-box;
    width: 13px; height: 13px; margin: 0 0.5em 0 -1.34em; vertical-align: -0.12em;
    border: 1.5px solid var(--dsh-mk-faint); border-radius: 3.5px; background-color: transparent;
  }
  .dsh-mk-surface li[data-item-type="task"][data-checked="true"] > p::before {
    border-color: var(--dsw-alias-state-success-primary, #1a7f37);
    background-color: var(--dsw-alias-state-success-primary, #1a7f37);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' d='M3.6 8.6l2.9 2.9 5.9-6'/%3E%3C/svg%3E");
    background-position: center; background-size: 11px 11px; background-repeat: no-repeat;
  }
  .dsh-mk-surface li[data-item-type="task"][data-checked="true"] > p { color: var(--dsh-mk-dim); }
`;

/** This plugin's own chrome. */
const CHROME = `
  .dsh-mk-root {
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    background: var(--dsh-mk-bg); color: var(--dsh-mk-text);
  }
  .dsh-mk-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .dsh-mk-pad { max-width: 54em; margin: 0 auto; padding: 18px 22px 64px; }
  .dsh-mk-nowrap .dsh-mk-pad { max-width: none; }

  .dsh-mk-notice {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 7px 12px; font-size: 12px; line-height: 1.5;
    border-bottom: 1px solid var(--dsh-mk-border); background: var(--dsh-mk-layer);
  }
  .dsh-mk-notice[data-kind="error"] { color: var(--dsh-mk-error); }
  .dsh-mk-notice[data-kind="conflict"] { color: var(--dsh-mk-warn); }
  .dsh-mk-notice-text { flex: 1 1 12em; min-width: 0; }
  .dsh-mk-button {
    appearance: none; border: 1px solid var(--dsh-mk-border); background: transparent;
    color: inherit; font: inherit; font-size: 12px; padding: 2px 9px; border-radius: 6px; cursor: pointer;
  }
  .dsh-mk-button:hover { background: var(--dsh-mk-hover); }
  .dsh-mk-button:active { background: var(--dsh-mk-active); }

  .dsh-mk-foot {
    flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
    padding: 5px 12px; font-size: 11px; line-height: 1.6;
    color: var(--dsh-mk-faint);
    border-top: 1px solid var(--dsh-mk-border); background: var(--dsh-mk-bg);
  }
  .dsh-mk-foot-path {
    flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    direction: rtl; text-align: left;
  }
  .dsh-mk-foot-state { flex: 0 0 auto; }
  .dsh-mk-foot-state[data-state="dirty"], .dsh-mk-foot-state[data-state="saving"] { color: var(--dsh-mk-warn); }
  .dsh-mk-foot-state[data-state="error"], .dsh-mk-foot-state[data-state="conflict"] { color: var(--dsh-mk-error); }
  .dsh-mk-foot-state[data-state="saved"] { color: var(--dsh-mk-faint); }

  .dsh-mk-center { padding: 18px 16px; font-size: 12px; color: var(--dsh-mk-dim); white-space: pre-wrap; }
  .dsh-mk-center[data-kind="error"] { color: var(--dsh-mk-error); }
`;

export const STYLE_TEXT = `${VARIABLES}${STRUCTURAL}${TYPOGRAPHY}${CHROME}`;

/** The id that makes injection idempotent across many open tabs. */
const STYLE_ID = 'dsh-sidebar-milkdown-style';

/**
 * Put the stylesheet in the document once.
 *
 * Called from the plugin body rather than from module scope: the client module is
 * evaluated in a worker-capable loader, and touching `document` at import time is
 * the kind of thing that only fails in production.
 * @param doc - the document to inject into.
 */
export function ensureStyles(doc) {
  if (doc === undefined || doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT.replace(/\n\s{2,}/g, '\n').replace(/\n{2,}/g, '\n');
  doc.head.append(style);
}
