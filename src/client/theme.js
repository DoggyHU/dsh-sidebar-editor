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
  .dsh-se-root {
    --dsh-se-text: var(--dsw-alias-label-primary, #1f2328);
    --dsh-se-dim: var(--dsw-alias-label-secondary, #59636e);
    --dsh-se-faint: var(--dsw-alias-label-tertiary, #818b98);
    /* The app's base surface, not the preview's reading tint: the shipped preview
       paints documents on bg-document-preview (a grey-blue in light mode), and reusing
       that made the editor look like a different app sitting inside this one. bg-base is
       white in light mode and near-black in dark, so the editor reads as the same surface
       as the rest of DSH and follows the theme. */
    --dsh-se-bg: var(--dsw-alias-bg-base, #ffffff);
    --dsh-se-border: var(--dsw-alias-border-l2, rgba(31, 35, 40, 0.12));
    --dsh-se-rule: var(--dsw-alias-border-l2, rgba(31, 35, 40, 0.2));
    --dsh-se-hover: var(--dsw-alias-interactive-bg-hover, rgba(31, 35, 40, 0.06));
    --dsh-se-active: var(--dsw-alias-interactive-bg-active, rgba(31, 35, 40, 0.1));
    /* Layer 2 is white in light mode and one step lighter than the page in dark, so
       code blocks and table headers need a hairline to stay visible in light mode. */
    --dsh-se-layer: var(--dsw-alias-bg-layer-2, #f6f8fa);
    --dsh-se-selection: var(--dsw-alias-bg-document-selection, rgba(84, 174, 255, 0.28));
    --dsh-se-error: var(--dsw-alias-state-error-primary, #cf222e);
    --dsh-se-warn: var(--dsw-alias-state-warn-secondary, #9a6700);
    --dsh-se-mono: var(--ds-font-family-code, var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace));
    /* The app's own family first, then CJK sans faces by name: an app stack of
       Latin-only faces makes Chromium resolve Chinese through its standard serif. */
    --dsh-se-font-stack: var(--dsw-font-family, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", -apple-system, "Segoe UI", sans-serif), "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
  }
`;

/** ProseMirror's own structural rules; the editor misbehaves without them. */
const STRUCTURAL = `
  .dsh-se-prose { position: relative; outline: none; }
  .dsh-se-prose.ProseMirror { word-wrap: break-word; white-space: pre-wrap; }
  .dsh-se-prose.ProseMirror pre { white-space: pre-wrap; }
  .dsh-se-prose.ProseMirror li { position: relative; }
  .dsh-se-nowrap .dsh-se-prose.ProseMirror { white-space: pre; }
  .dsh-se-prose.ProseMirror-hideselection *::selection { background: transparent; }
  .dsh-se-prose.ProseMirror-hideselection { caret-color: transparent; }
  .dsh-se-prose.ProseMirror-selectednode { outline: 2px solid var(--dsh-se-selection); }
  .dsh-se-prose li.ProseMirror-selectednode { outline: none; }
  .dsh-se-prose li.ProseMirror-selectednode:after {
    content: ''; position: absolute; left: -28px; right: -2px; top: -2px; bottom: -2px;
    border: 2px solid var(--dsh-se-selection); pointer-events: none;
  }
  .dsh-se-prose img.ProseMirror-selectednode { border-radius: 3px; }
  .dsh-se-prose [contenteditable="false"] { white-space: normal; }
  .dsh-se-prose [contenteditable="false"] [contenteditable="true"] { white-space: pre-wrap; }
  .dsh-se-prose .ProseMirror-gapcursor { display: none; pointer-events: none; position: absolute; }
  .dsh-se-prose .ProseMirror-gapcursor:after {
    content: ''; display: block; position: absolute; top: -2px; width: 20px;
    border-top: 1px solid var(--dsh-se-text);
    animation: dsh-se-caret-blink 1.1s steps(2, start) infinite;
  }
  @keyframes dsh-se-caret-blink { to { visibility: hidden; } }
  .dsh-se-prose.ProseMirror-focused .ProseMirror-gapcursor { display: block; }
`;

/**
 * The document's typography.
 *
 * A transcription of the shipped `._markdown_*` rules — same tokens, same margins,
 * same table paddings — so an editable document looks like the read-only one it
 * replaces.
 *
 * Two deliberate departures from the shipped file, both learned from a real report
 * that the editor rendered in a serif face while the app was sans:
 *
 *  1. **longhands, not the `font:` shorthand.** The theme publishes granular tokens
 *     (`--dsw-font-markdown-base-font-family` / `-size` / `-line-height` /
 *     `-font-weight`). A shorthand whose token is missing is invalid as a whole and
 *     silently falls back to inherited/browser defaults; a longhand that is missing
 *     only loses that one property.
 *  2. **a CJK sans fallback after the app family.** If the app's family list has no
 *     CJK face (Inter/Segoe UI do not), Chinese glyphs resolve through the browser's
 *     *standard* font — which is a serif (Times New Roman / 宋体) in Chromium. Naming
 *     the CJK faces explicitly is what keeps a Chinese document sans.
 */
const TYPOGRAPHY = `
  .dsh-se-surface {
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--dsh-se-font-stack);
    font-size: var(--dsw-font-markdown-base-font-size, 14px);
    font-weight: var(--dsw-font-markdown-base-font-weight, 400);
    line-height: var(--dsw-font-markdown-base-line-height, 1.72);
    color: var(--dsh-se-text);
    -webkit-font-smoothing: antialiased;
  }
  .dsh-se-surface ::selection { background: var(--dsh-se-selection); }
  .dsh-se-surface strong { font-weight: 600; }

  .dsh-se-surface h1 {
    font-family: var(--dsw-font-markdown-h1-font-family, var(--dsh-se-font-stack));
    font-size: var(--dsw-font-markdown-h1-font-size, 22px);
    font-weight: var(--dsw-font-markdown-h1-font-weight, 600);
    line-height: var(--dsw-font-markdown-h1-line-height, 1.35);
    margin: 32px 0 16px;
  }
  .dsh-se-surface h2 {
    font-family: var(--dsw-font-markdown-h2-font-family, var(--dsh-se-font-stack));
    font-size: var(--dsw-font-markdown-h2-font-size, 18px);
    font-weight: var(--dsw-font-markdown-h2-font-weight, 600);
    line-height: var(--dsw-font-markdown-h2-line-height, 1.4);
    margin: 32px 0 16px;
  }
  .dsh-se-surface h3 {
    font-family: var(--dsw-font-markdown-h3-font-family, var(--dsh-se-font-stack));
    font-size: var(--dsw-font-markdown-h3-font-size, 16px);
    font-weight: var(--dsw-font-markdown-h3-font-weight, 600);
    line-height: var(--dsw-font-markdown-h3-line-height, 1.45);
    margin: 32px 0 16px;
  }
  .dsh-se-surface h4 {
    font-family: var(--dsw-font-markdown-h4-font-family, var(--dsh-se-font-stack));
    font-size: var(--dsw-font-markdown-h4-font-size, 15px);
    font-weight: var(--dsw-font-markdown-h4-font-weight, 600);
    line-height: var(--dsw-font-markdown-h4-line-height, 1.5);
    margin: 16px 0;
  }
  .dsh-se-surface :where(h5, h6) {
    font-family: var(--dsw-font-markdown-base-font-family, var(--dsh-se-font-stack));
    font-size: var(--dsw-font-markdown-base-font-size, 14px);
    font-weight: 600;
    line-height: var(--dsw-font-markdown-base-line-height, 1.72);
    margin: 16px 0;
  }
  .dsh-se-surface :where(h1, h2, h3, h4, h5, h6) strong { font-weight: inherit; }
  .dsh-se-surface > *:first-child, .dsh-se-surface p:first-child { margin-top: 0 !important; }
  .dsh-se-surface > *:last-child, .dsh-se-surface p:last-child { margin-bottom: 0 !important; }

  .dsh-se-surface p { margin: 16px 0; }

  .dsh-se-surface a {
    color: var(--dsw-alias-link, #4d6bfe);
    font-weight: 500;
    text-decoration: none;
  }
  .dsh-se-surface a:hover, .dsh-se-surface a:focus {
    outline: none;
    text-decoration: underline dotted var(--dsw-alias-link, #4d6bfe);
    text-underline-offset: 3px;
  }

  .dsh-se-surface :where(ul, ol) { margin: 16px 0; padding-left: 18px; }
  .dsh-se-surface li:not(:first-child) { margin-top: 6px; }
  .dsh-se-surface li > :where(ul, ol) { margin-top: 4px; }
  .dsh-se-surface li::marker { line-height: 24px; color: var(--dsh-se-dim); }
  .dsh-se-surface li > p { margin: 8px 0; }
  .dsh-se-surface li > *:first-child { margin-top: 0; }
  .dsh-se-surface li > *:last-child { margin-bottom: 0; }

  .dsh-se-surface hr {
    display: block; border: none; height: 0.5px; margin: 32px 0;
    background: var(--dsh-se-rule);
  }

  .dsh-se-surface blockquote {
    border-left: 2px solid var(--dsw-alias-label-caption, var(--dsh-se-faint));
    margin: 16px 0 0; padding-left: 14px;
  }

  .dsh-se-surface pre {
    margin: 16px 0; padding: 12px 14px; overflow: auto;
    background: var(--dsh-se-layer);
    border: 1px solid var(--dsh-se-border);
    border-radius: var(--dsw-radius-md, 8px);
    font-family: var(--dsw-font-markdown-code-font-family, var(--dsh-se-mono));
    font-size: 0.86em;
    font-weight: 400;
    line-height: 1.6;
  }
  .dsh-se-surface pre code { padding: 0; border: none; background: none; font: inherit; }

  .dsh-se-surface :not(pre) > code {
    font-family: var(--dsw-font-markdown-code-font-family, var(--ds-font-family-code, var(--dsh-se-mono)));
    font-size: 0.875em;
    font-weight: 400;
    line-height: 1.5;
    background-color: var(--dsw-alias-markdown-inline-code, var(--dsh-se-layer));
    border: 0.5px solid var(--dsw-alias-border-l1, var(--dsh-se-border));
    border-radius: var(--dsw-radius-sm, 4px);
    padding: 0 5px;
  }
  .dsh-se-surface :where(h1, h2, h3, h4, h5, h6) code { font: inherit; font-family: var(--dsh-se-mono); }

  .dsh-se-surface img { display: block; max-width: 100%; height: auto; border-radius: var(--dsw-radius-md, 8px); }

  /* GFM tables: the shipped preview draws horizontal rules only, and scrolls
     sideways instead of squeezing columns. prosemirror-tables wraps the table in
     .tableWrapper, which is this plugin's scroll container. */
  .dsh-se-surface .tableWrapper { max-width: 100%; overflow-x: auto; overscroll-behavior-x: contain; }
  .dsh-se-surface table { border-collapse: collapse; width: max-content; max-width: max-content; }
  .dsh-se-surface th {
    text-align: start; padding: 10px 16px;
    border-bottom: 0.5px solid var(--dsw-alias-border-l3, var(--dsh-se-rule));
    font-family: var(--dsw-font-markdown-table-head-font-family, var(--dsh-se-font-stack));
    font-size: 13px;
    font-weight: 600;
    line-height: 1.5;
    min-width: 100px;
  }
  .dsh-se-surface td {
    padding: 10px 16px;
    border-bottom: 0.5px solid var(--dsh-se-rule);
    font-family: var(--dsw-font-markdown-table-font-family, var(--dsh-se-font-stack));
    font-size: 13px;
    font-weight: 400;
    line-height: 1.5;
    min-width: 100px;
  }
  .dsh-se-surface th:first-child, .dsh-se-surface td:first-child { padding-left: 0; }
  .dsh-se-surface td:last-child { padding-right: 0; }
  .dsh-se-surface table p { margin: 0; }
  .dsh-se-surface table code { font-size: 11px; }
  .dsh-se-surface th.selectedCell:after, .dsh-se-surface td.selectedCell:after {
    content: ''; position: absolute; inset: 0; background: var(--dsh-se-selection); pointer-events: none;
  }
  .dsh-se-surface th, .dsh-se-surface td { position: relative; }
  .dsh-se-surface .column-resize-handle {
    position: absolute; right: -2px; top: 0; bottom: -2px; width: 4px;
    background: var(--dsh-se-selection); pointer-events: none;
  }
  .dsh-se-surface .resize-cursor { cursor: col-resize; }

  /* GFM task lists. The schema renders an li[data-item-type="task"] with a
     data-checked attribute rather than an <input>, so the box is drawn here instead
     of by a node view. The box hangs off the item's first paragraph: on the li
     itself it would sit on its own line, because the paragraph after it is a block. */
  .dsh-se-surface li[data-item-type="task"] { list-style: none; }
  .dsh-se-surface li[data-item-type="task"] > p::before {
    content: ''; display: inline-block; box-sizing: border-box;
    width: 13px; height: 13px; margin: 0 8px 0 -1.6em; vertical-align: -0.12em;
    border: 1px solid var(--dsh-se-faint); border-radius: 3px; background-color: transparent;
  }
  .dsh-se-surface li[data-item-type="task"][data-checked="true"] > p::before {
    border-color: var(--dsw-alias-state-success-primary, #1a7f37);
    background-color: var(--dsw-alias-state-success-primary, #1a7f37);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' d='M3.6 8.6l2.9 2.9 5.9-6'/%3E%3C/svg%3E");
    background-position: center; background-size: 11px 11px; background-repeat: no-repeat;
  }
  .dsh-se-surface li[data-item-type="task"][data-checked="true"] > p { color: var(--dsh-se-dim); }
`;

/** This plugin's own chrome. */
const CHROME = `
  .dsh-se-root {
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    background: var(--dsh-se-bg); color: var(--dsh-se-text);
  }
  .dsh-se-scroll { position: relative; flex: 1 1 auto; min-height: 0; overflow: auto; }
  .dsh-se-pad { max-width: 54em; margin: 0 auto; padding: 18px 22px 64px; }
  .dsh-se-nowrap .dsh-se-pad { max-width: none; }

  .dsh-se-notice {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 7px 12px; font-size: 12px; line-height: 1.5;
    border-bottom: 1px solid var(--dsh-se-border); background: var(--dsh-se-layer);
  }
  .dsh-se-notice[data-kind="error"] { color: var(--dsh-se-error); }
  .dsh-se-notice[data-kind="conflict"] { color: var(--dsh-se-warn); }
  .dsh-se-notice[data-kind="external"] { color: var(--dsh-se-warn); }
  .dsh-se-notice-text { flex: 1 1 12em; min-width: 0; }

  .dsh-se-button {
    appearance: none; border: 1px solid var(--dsh-se-border); background: transparent;
    color: inherit; font: inherit; font-size: 12px; padding: 2px 9px; border-radius: 6px; cursor: pointer;
  }
  .dsh-se-button:hover { background: var(--dsh-se-hover); }
  .dsh-se-button:active { background: var(--dsh-se-active); }
  .dsh-se-button:disabled { opacity: 0.45; cursor: default; background: transparent; }

  /* Rows this plugin appends to the dock tab's context menu. dockkit's own menu item
     class lives in its CSS module and cannot be imported, so the look is reproduced
     here to match it: same padding, type size, radius and hover fill. */
  .dsh-se-tab-menu-item {
    padding: 4px 7px; width: 100%; text-align: left; background: transparent;
    color: var(--dsw-alias-label-primary, #1f2328);
    font-family: var(--dsw-font-family, inherit);
    font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
    border: none; border-radius: var(--dsw-radius-md, 6px); cursor: pointer;
  }
  .dsh-se-tab-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(31, 35, 40, 0.06)); }
  .dsh-se-tab-menu-item:active { background: var(--dsw-alias-interactive-bg-active, rgba(31, 35, 40, 0.1)); }

  /* The table affordance: ＋行 / ＋列, positioned over the table it belongs to. */
  .dsh-se-table-tools {
    position: absolute; z-index: 5; display: flex; gap: 2px; padding: 2px;
    border-radius: 8px; background: var(--dsh-se-bg);
    border: 1px solid var(--dsh-se-border);
    box-shadow: 0 1px 6px rgba(15, 23, 42, 0.12);
  }
  .dsh-se-table-tools .dsh-se-button {
    padding: 0 7px; font-size: 11px; line-height: 20px; border-color: transparent; white-space: nowrap;
  }

  .dsh-se-foot {
    flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
    padding: 5px 12px; font-size: 11px; line-height: 1.6;
    color: var(--dsh-se-faint);
    border-top: 1px solid var(--dsh-se-border); background: var(--dsh-se-bg);
  }
  .dsh-se-foot-path {
    flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    direction: rtl; text-align: left;
  }
  .dsh-se-foot-state { flex: 0 0 auto; }
  .dsh-se-foot-state[data-state="dirty"] { color: var(--dsh-se-warn); }
  .dsh-se-foot-state[data-state="saving"] { color: var(--dsh-se-warn); }
  .dsh-se-foot-state[data-state="error"], .dsh-se-foot-state[data-state="conflict"] { color: var(--dsh-se-error); }
  .dsh-se-foot-state[data-state="saved"] { color: var(--dsh-se-faint); }

  .dsh-se-center { padding: 18px 16px; font-size: 12px; color: var(--dsh-se-dim); white-space: pre-wrap; }
  .dsh-se-center[data-kind="error"] { color: var(--dsh-se-error); }
`;

export const STYLE_TEXT = `${VARIABLES}${STRUCTURAL}${TYPOGRAPHY}${CHROME}`;

/** The id that makes injection idempotent across many open tabs. */
const STYLE_ID = 'dsh-sidebar-editor-style';

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
