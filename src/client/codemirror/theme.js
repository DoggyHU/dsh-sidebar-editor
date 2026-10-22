/**
 * CodeMirror appearance bound to the shell's own tokens.
 *
 * Colours come from the design tokens the shell defines on `body`, so the editor
 * follows light/dark and any custom theme without the plugin knowing about them.
 * Syntax colours reuse the `--shiki-token-*` variables the shell already sets for
 * Markdown code blocks, which is what makes the editor match the code the chat
 * renders.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { EditorView } from '@codemirror/view';

/** Attribute the shell sets on `<body>` while the dark theme is active. */
const DARK_ATTRIBUTE = 'data-ds-dark-theme';

/**
 * Whether the shell currently renders the dark theme.
 * @returns true when the dark attribute is present.
 */
export function isDarkTheme() {
  return typeof document !== 'undefined' && document.body?.hasAttribute(DARK_ATTRIBUTE) === true;
}

/**
 * Observe theme switches without importing the shell's theme service.
 * @param listener - called after the dark attribute changes.
 * @returns its disposer.
 */
export function observeTheme(listener) {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(() => listener());
  observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] });
  return () => observer.disconnect();
}

/**
 * Build the editor chrome theme.
 * @param dark - whether the shell is in its dark theme; only affects CodeMirror's
 * own defaults, since every colour below is a shell variable.
 * @returns the theme extension.
 */
export function chromeTheme(dark) {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: '12.5px',
        color: 'var(--dsw-alias-label-primary, #1c2024)',
        backgroundColor: 'var(--dsw-alias-bg-document-preview, var(--dsw-alias-bg-base, #ffffff))',
      },
      '.cm-scroller': {
        // The shipped code surface reads `--ds-font-family-code`; prefer it, and fall
        // back to the older mono token so this still works on an older build.
        fontFamily:
          'var(--ds-font-family-code, var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace))',
        lineHeight: '1.6',
      },
      '.cm-content': {
        padding: '8px 0',
        caretColor: 'var(--dsw-alias-label-primary, #1c2024)',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none',
        color: 'var(--dsw-alias-label-tertiary, #98a2b3)',
      },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 12px' },
      '.cm-activeLine': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))' },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dsw-alias-label-primary, #1c2024)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--dsw-alias-bg-document-selection, rgba(59, 130, 246, 0.4))',
      },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.12))',
        outline: 'none',
      },
      '.cm-panels': {
        backgroundColor: 'var(--dsw-alias-bg-layer-2, transparent)',
        color: 'var(--dsw-alias-label-primary, #1c2024)',
      },
      '.cm-searchMatch': { backgroundColor: 'var(--dsw-alias-state-warn-tertiary, #fef5e7)' },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'var(--dsw-alias-state-warn-secondary, #f7ad31)',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
      },
    },
    { dark },
  );
}

/** Syntax colours mapped onto the shell's Shiki token variables. */
const highlight = HighlightStyle.define([
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta],
    color: 'var(--shiki-token-comment, #868e96)',
    fontStyle: 'italic',
  },
  {
    tag: [t.keyword, t.operatorKeyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.modifier],
    color: 'var(--shiki-token-keyword, #d6336c)',
  },
  {
    tag: [t.string, t.special(t.string), t.regexp, t.character, t.docString],
    color: 'var(--shiki-token-string, #2f9e44)',
  },
  {
    tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.self, t.unit],
    color: 'var(--shiki-token-constant, #1c7ed6)',
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.labelName,
      t.definition(t.variableName),
    ],
    color: 'var(--shiki-token-function, #6741d9)',
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.tagName, t.attributeName],
    color: 'var(--shiki-token-parameter, #e8590c)',
  },
  {
    tag: [t.propertyName, t.variableName, t.local(t.variableName), t.special(t.variableName)],
    color: 'var(--shiki-foreground, inherit)',
  },
  {
    tag: [t.punctuation, t.separator, t.bracket, t.squareBracket, t.paren, t.brace, t.operator, t.escape],
    color: 'var(--shiki-token-punctuation, #495057)',
  },
  { tag: [t.link, t.url], color: 'var(--shiki-token-link, #1971c2)', textDecoration: 'underline' },
  { tag: [t.heading, t.strong], fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.invalid, color: 'var(--dsw-alias-state-error-primary, #ef4444)' },
]);

/** The highlight extension bundling the mapping above. */
export const shellHighlighting = syntaxHighlighting(highlight);
