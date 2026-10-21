/**
 * The editor's stylesheet.
 *
 * Four layers, in this order:
 *
 *  1. custom properties, on the plugin's own root — they have to live inside a rule,
 *     because a stylesheet that opens with a bare declaration is dropped whole and
 *     takes every rule below it with it (no error anywhere);
 *  2. ProseMirror's structural rules. A contenteditable needs `position: relative` on
 *     the editing host (gap cursor, selected-node outline), `pre-wrap` so newlines
 *     survive, and the selected-node/gap-cursor rules, or dropping the caret between
 *     two blocks looks like the plugin is broken;
 *  3. the document's typography, transcribed from the shipped preview's own Markdown
 *     stylesheet (`--dsw-font-markdown-*`, `--dsw-alias-markdown-*`, table paddings).
 *     Using those tokens instead of literal sizes is what makes the editor follow the
 *     user's font settings: the theme service recomputes them when the setting
 *     changes, and the preview and this editor move together;
 *  4. this plugin's chrome: the notice strip, the table buttons and the status foot.
 */

/**
 * Custom properties on the plugin root.
 *
 * Each one points at an app token with a literal fallback, so the editor is still
 * legible in a page without the theme (the test harness is exactly that page) and
 * still correct in the app.
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
    --dsh-mk-body-font: var(--dsw-font-markdown-base, 400 14px/1.72 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif);
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

/**
 * The document's typography.
 *
 * A transcription of the shipped `._markdown_*` rules — same tokens, same margins,
 * same table paddings — so an editable document looks like the read-only one it
 * replaces. Literal fallbacks exist only for a page without the theme.
 */
const TYPOGRAPHY = `
  .dsh-mk-surface {
    min-width: 0;
    overflow-wrap: anywhere;
    font: var(--dsh-mk-body-font);
    color: var(--dsh-mk-text);
    -webkit-font-smoothing: antialiased;
  }
  .dsh-mk-surface ::selection { background: var(--dsh-mk-selection); }
  .dsh-mk-surface strong { font-weight: 600; }

  .dsh-mk-surface h1 { font: var(--dsw-font-markdown-h1, 600 22px/1.35 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif); margin: 32px 0 16px; }
  .dsh-mk-surface h2 { font: var(--dsw-font-markdown-h2, 600 18px/1.4 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif); margin: 32px 0 16px; }
  .dsh-mk-surface h3 { font: var(--dsw-font-markdown-h3, 600 16px/1.45 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif); margin: 32px 0 16px; }
  .dsh-mk-surface h4 { font: var(--dsw-font-markdown-h4, 600 15px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif); margin: 16px 0; }
  .dsh-mk-surface :where(h5, h6) {
    font: var(--dsw-font-markdown-base-strong, 600 14px/1.72 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif);
    margin: 16px 0;
  }
  .dsh-mk-surface :where(h1, h2, h3, h4, h5, h6) strong { font-weight: inherit; }
  .dsh-mk-surface > *:first-child, .dsh-mk-surface p:first-child { margin-top: 0 !important; }
  .dsh-mk-surface > *:last-child, .dsh-mk-surface p:last-child { margin-bottom: 0 !important; }

  .dsh-mk-surface p { margin: 16px 0; }

  .dsh-mk-surface a {
    color: var(--dsw-alias-link, #4d6bfe);
    font-weight: 500;
    text-decoration: none;
  }
  .dsh-mk-surface a:hover, .dsh-mk-surface a:focus {
    outline: none;
    text-decoration: underline dotted var(--dsw-alias-link, #4d6bfe);
    text-underline-offset: 3px;
  }

  .dsh-mk-surface :where(ul, ol) { margin: 16px 0; padding-left: 18px; }
  .dsh-mk-surface li:not(:first-child) { margin-top: 6px; }
  .dsh-mk-surface li > :where(ul, ol) { margin-top: 4px; }
  .dsh-mk-surface li::marker { line-height: 24px; color: var(--dsh-mk-dim); }
  .dsh-mk-surface li > p { margin: 8px 0; }
  .dsh-mk-surface li > *:first-child { margin-top: 0; }
  .dsh-mk-surface li > *:last-child { margin-bottom: 0; }

  .dsh-mk-surface hr {
    display: block; border: none; height: 0.5px; margin: 32px 0;
    background: var(--dsh-mk-rule);
  }

  .dsh-mk-surface blockquote {
    border-left: 2px solid var(--dsw-alias-label-caption, var(--dsh-mk-faint));
    margin: 16px 0 0; padding-left: 14px;
  }

  .dsh-mk-surface pre {
    margin: 16px 0; padding: 12px 14px; overflow: auto;
    background: var(--dsh-mk-layer); border-radius: var(--dsw-radius-md, 8px);
    font: var(--dsw-font-markdown-code-block, 400 12px/1.6 var(--dsh-mk-mono));
    font-family: var(--dsh-mk-mono);
    font-size: 0.86em;
  }
  .dsh-mk-surface pre code { padding: 0; border: none; background: none; font: inherit; }

  .dsh-mk-surface :not(pre) > code {
    font: var(--dsw-font-markdown-code, 400 0.875em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-family: var(--ds-font-family-code, var(--dsh-mk-mono));
    font-size: 0.875em;
    background-color: var(--dsw-alias-markdown-inline-code, var(--dsh-mk-layer));
    border: 0.5px solid var(--dsw-alias-border-l1, var(--dsh-mk-border));
    border-radius: var(--dsw-radius-sm, 4px);
    padding: 0 5px;
  }
  .dsh-mk-surface :where(h1, h2, h3, h4, h5, h6) code { font: inherit; font-family: var(--dsh-mk-mono); }

  .dsh-mk-surface img { display: block; max-width: 100%; height: auto; border-radius: var(--dsw-radius-md, 8px); }

  /* GFM tables: the shipped preview draws horizontal rules only, and scrolls
     sideways instead of squeezing columns. prosemirror-tables wraps the table in
     .tableWrapper, which is this plugin's scroll container. */
  .dsh-mk-surface .tableWrapper { max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; }
  .dsh-mk-surface table { border-collapse: collapse; width: max-content; max-width: max-content; }
  .dsh-mk-surface th {
    text-align: start; padding: 10px 16px;
    border-bottom: 0.5px solid var(--dsw-alias-border-l3, var(--dsh-mk-rule));
    font: var(--dsw-font-markdown-table-head, 600 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif);
    min-width: 100px;
  }
  .dsh-mk-surface td {
    padding: 10px 16px;
    border-bottom: 0.5px solid var(--dsh-mk-rule);
    font: var(--dsw-font-markdown-table, 400 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif);
    min-width: 100px;
  }
  .dsh-mk-surface th:first-child, .dsh-mk-surface td:first-child { padding-left: 0; }
  .dsh-mk-surface td:last-child { padding-right: 0; }
  .dsh-mk-surface table p { margin: 0; }
  .dsh-mk-surface table code { font-size: 11px; }
  .dsh-mk-surface th.selectedCell:after, .dsh-mk-surface td.selectedCell:after {
    content: ''; position: absolute; inset: 0; background: var(--dsh-mk-selection); pointer-events: none;
  }
  .dsh-mk-surface th, .dsh-mk-surface td { position: relative; }
  .dsh-mk-surface .column-resize-handle {
    position: absolute; right: -2px; top: 0; bottom: -2px; width: 4px;
    background: var(--dsh-mk-selection); pointer-events: none;
  }
  .dsh-mk-surface .resize-cursor { cursor: col-resize; }

  /* GFM task lists. The schema renders an li[data-item-type="task"] with a
     data-checked attribute rather than an <input>, so the box is drawn here instead
     of by a node view. The box hangs off the item's first paragraph: on the li
     itself it would sit on its own line, because the paragraph after it is a block. */
  .dsh-mk-surface li[data-item-type="task"] { list-style: none; }
  .dsh-mk-surface li[data-item-type="task"] > p::before {
    content: ''; display: inline-block; box-sizing: border-box;
    width: 13px; height: 13px; margin: 0 8px 0 -1.6em; vertical-align: -0.12em;
    border: 1px solid var(--dsh-mk-faint); border-radius: 3px; background-color: transparent;
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
  .dsh-mk-scroll { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; }
  .dsh-mk-pad { max-width: 54em; margin: 0 auto; padding: 18px 22px 64px; }
  .dsh-mk-nowrap .dsh-mk-pad { max-width: none; }

  .dsh-mk-notice {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 7px 12px; font-size: 12px; line-height: 1.5;
    border-bottom: 1px solid var(--dsh-mk-border); background: var(--dsh-mk-layer);
  }
  .dsh-mk-notice[data-kind="error"] { color: var(--dsh-mk-error); }
  .dsh-mk-notice[data-kind="conflict"] { color: var(--dsh-mk-warn); }
  .dsh-mk-notice[data-kind="external"] { color: var(--dsh-mk-warn); }
  .dsh-mk-notice-text { flex: 1 1 12em; min-width: 0; }

  .dsh-mk-button {
    appearance: none; border: 1px solid var(--dsh-mk-border); background: transparent;
    color: inherit; font: inherit; font-size: 12px; padding: 2px 9px; border-radius: 6px; cursor: pointer;
  }
  .dsh-mk-button:hover { background: var(--dsh-mk-hover); }
  .dsh-mk-button:active { background: var(--dsh-mk-active); }
  .dsh-mk-button:disabled { opacity: 0.45; cursor: default; background: transparent; }

  /* The table affordance: ＋行 / ＋列, positioned over the table it belongs to. */
  .dsh-mk-table-tools {
    position: absolute; z-index: 5; display: flex; gap: 2px; padding: 2px;
    border-radius: 8px; background: var(--dsh-mk-bg);
    border: 1px solid var(--dsh-mk-border);
    box-shadow: 0 1px 6px rgba(15, 23, 42, 0.12);
  }
  .dsh-mk-table-tools .dsh-mk-button {
    padding: 0 7px; font-size: 11px; line-height: 20px; border-color: transparent; white-space: nowrap;
  }

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
  .dsh-mk-foot-state[data-state="dirty"] { color: var(--dsh-mk-warn); }
  .dsh-mk-foot-state[data-state="saving"] { color: var(--dsh-mk-warn); }
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
 * evaluated by a loader that may run before a document exists, and touching
 * `document` at import time is the kind of thing that only fails in production.
 * @param doc - the document to inject into.
 */
export function ensureStyles(doc) {
  if (doc === undefined || doc.getElementById(STYLE_ID) !== null) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_TEXT.replace(/\n\s{2,}/g, '\n').replace(/\n{2,}/g, '\n');
  doc.head.append(style);
}
