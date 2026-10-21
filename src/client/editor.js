/**
 * The editor itself: one ProseMirror document, one view, Markdown on both sides.
 *
 * This file is deliberately the only place that knows Milkdown exists. The React
 * body hands it a DOM element and a Markdown string, and asks it two questions —
 * "what is the Markdown now?" and "destroy yourself". Everything that used to be a
 * bug in the CodeMirror-based plugin (`<br>` written to disk, IME composition
 * landing in a node a re-render replaced, selections clamped at block borders)
 * belongs to the editor's own model here, so there is nothing for us to arbitrate.
 *
 * Milkdown's defaults are used for everything except:
 *
 *  - the editing host's attributes, so the type scale is ours;
 *  - `editable`, so a file outside the workspace opens read-only;
 *  - the markdown listener, which is how the body learns it has unsaved changes.
 *
 * `history`, `listener` and `gfm` are opt-in plugins; `commonmark` supplies the
 * Markdown node/mark schema that `gfm` extends.
 */
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { commonmark, remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { newlineInCode, setBlockType, splitBlock } from '@milkdown/kit/prose/commands';
import { splitListItem } from '@milkdown/kit/prose/schema-list';

/**
 * Split a heading, leaving a paragraph after it.
 *
 * ProseMirror's `splitBlock` keeps the block type, so Enter inside a heading would
 * produce two headings. The behaviour this editor promises (and the one the
 * CodeMirror route settled on) is that a line break starts body text: the trailing
 * half becomes a paragraph.
 * @param view - the ProseMirror view.
 * @returns true when the key was handled.
 */
function splitHeading(view) {
  const { state } = view;
  const paragraph = state.schema.nodes.paragraph;
  if (paragraph === undefined) return false;
  let dispatched = false;
  splitBlock(
    state,
    (transaction) => {
      view.dispatch(transaction.scrollIntoView());
      dispatched = true;
    },
    view,
  );
  if (dispatched !== true) return false;
  // The caret is now in the second half; demote that block to a paragraph. The key
  // is claimed either way: ProseMirror must not run its base keymap on the state we
  // just dispatched, or Enter would split the block a second time.
  setBlockType(paragraph)(view.state, view.dispatch, view);
  return true;
}

/**
 * Break the current block the way plain Enter does, for Shift+Enter.
 *
 * ProseMirror's base keymap makes Shift+Enter insert a `hardbreak` node, which
 * serializes as a trailing backslash or a `<br>` depending on the writer. This
 * editor's rule is the one the CodeMirror route settled on and the user accepted:
 * a line break means a new block, never a hard break inside one. So Shift+Enter is
 * routed to whatever Enter would do in this position — a new list item inside a
 * list, a code line inside a code block, a new paragraph otherwise.
 * @param view - the ProseMirror view.
 * @returns true when a command handled the key.
 */
function splitLikeEnter(view) {
  const { state } = view;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'code_block') return newlineInCode(state, view.dispatch);
  }
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'list_item') {
      return splitListItem(state.schema.nodes.list_item)(state, view.dispatch, view);
    }
  }
  if ($from.parent.type.name === 'heading') return splitHeading(view);
  return splitBlock(state, view.dispatch, view);
}

/**
 * The CommonMark preset without its empty-paragraph placeholder.
 *
 * Milkdown has no Markdown representation for an empty paragraph, so
 * `remarkPreserveEmptyLinePlugin` writes one as a literal `<br />`. That is the
 * exact string the user rejected in the previous plugin: the shipped preview does
 * not render raw HTML, so `<br />` reappears on the next open as visible text. An
 * empty paragraph carries no content, so dropping it on save is the honest
 * trade — the alternative is writing HTML into a Markdown file.
 */
const EMPTY_LINE_PLUGINS = new Set([remarkPreserveEmptyLinePlugin.plugin, remarkPreserveEmptyLinePlugin.options]);
const COMMONMARK = commonmark.filter((plugin) => EMPTY_LINE_PLUGINS.has(plugin) === false);

/**
 * Split a leading YAML frontmatter block off a Markdown file.
 *
 * The schema has no node for frontmatter, and `prosemirror-markdown`-style
 * round-tripping would turn `---` into a horizontal rule and mangle the keys. A
 * document that has one is therefore edited as its body, with the block carried
 * through the plugin verbatim and re-joined on save, so opening an Obsidian note
 * cannot destroy its metadata.
 * @param text - the file's text, LF line endings.
 * @returns `{ front, body }`, where `front` includes the closing fence and its newline.
 */
export function splitFrontmatter(text) {
  if (typeof text !== 'string' || !text.startsWith('---\n')) return { front: '', body: text ?? '' };
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (match === null) return { front: '', body: text };
  return { front: match[0], body: text.slice(match[0].length) };
}

/**
 * Re-attach a preserved frontmatter block to a serialized body.
 * @param front - the block returned by {@link splitFrontmatter}, possibly empty.
 * @param body - the serialized body Markdown.
 * @returns the text to write to disk.
 */
export function joinFrontmatter(front, body) {
  if (front === '') return body;
  // Milkdown always serializes at least one trailing newline; a frontmatter block
  // already carries its own separator, so avoid producing a blank line after it.
  return `${front}${body === '' ? '' : body.replace(/^\n+/, '')}`;
}

/**
 * Mount a Milkdown editor into an element.
 * @param options - `{ root, markdown, editable, onChange }`.
 * @param options.root - element to own the editing host; its children are replaced.
 * @param options.markdown - initial body Markdown (frontmatter already stripped).
 * @param options.editable - false renders a read-only document.
 * @param options.onChange - called with the serialized Markdown after every doc change.
 * @param options.onBlur - called once when the editing host loses focus.
 * @returns the created `Editor`.
 */
export async function mountMilkdown({ root, markdown, editable = true, onChange, onBlur }) {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(editorViewOptionsCtx, {
        // A function, not a value: the owner may flip read-only after a save was
        // refused, and the view has to follow without a remount.
        editable: () => editable !== false,
        attributes: {
          class: 'dsh-mk-prose dsh-mk-surface',
          spellcheck: 'false',
          autocapitalize: 'off',
          autocorrect: 'off',
        },
        // Enter rules: never a hard break, and a heading is followed by body text.
        handleKeyDown: (view, event) => {
          if (event.key !== 'Enter' || event.isComposing === true) return false;
          if (event.shiftKey === true) return splitLikeEnter(view);
          return view.state.selection.$from.parent.type.name === 'heading' ? splitHeading(view) : false;
        },
      });
      const manager = ctx.get(listenerCtx);
      manager.markdownUpdated((_ctx, next) => {
        if (typeof onChange === 'function') onChange(next);
      });
      if (typeof onBlur === 'function') manager.blur(() => onBlur());
      // Keep the file's own punctuation where the serializer would otherwise pick
      // a synonym: remark-stringify defaults to `*` bullets and `***` rules, which
      // would rewrite every list in a `-`-style file on the first edit. The
      // handlers are spread through untouched — they are Milkdown's own node
      // serializers, not options this plugin has any business replacing.
      ctx.update(remarkStringifyOptionsCtx, (previous) => ({
        ...previous,
        // remark-stringify requires the two bullet characters to differ; `-` is the
        // one every Markdown file written by hand on this machine uses.
        bullet: '-',
        bulletOther: '*',
        rule: '-',
        emphasis: '*',
        strong: '*',
        fence: '`',
      }));
    })
    .use(COMMONMARK)
    .use(gfm)
    .use(history)
    .use(listener);

  await editor.create();
  // Test-only handle. The browser harness needs the ProseMirror view to tell a
  // click that moved the DOM selection from one that moved the document selection,
  // and there is no other honest way to ask. Off unless the page opts in.
  if (globalThis.__DSH_MILKDOWN_DEBUG__ === true) {
    try {
      root.dshMilkdownEditor = editor;
      root.dshMilkdownView = editor.action((ctx) => ctx.get(editorViewCtx));
    } catch {
      /* the handle is a convenience, never a requirement */
    }
  }
  return editor;
}

/**
 * The document's current Markdown.
 *
 * Read through the serializer rather than from a listener's last value: listeners
 * only fire on changes, so the value a freshly mounted editor would report is
 * whatever the previous document said.
 * @param editor - a created editor.
 * @returns the serialized Markdown, or `''` when the editor is not usable.
 */
export function readMarkdown(editor) {
  try {
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serialize = ctx.get(serializerCtx);
      return serialize(view.state.doc);
    });
  } catch {
    return '';
  }
}

/**
 * Focus the editing host.
 * @param editor - a created editor.
 */
export function focusEditor(editor) {
  try {
    editor.action((ctx) => ctx.get(editorViewCtx).focus());
  } catch {
    /* focus is never worth throwing over */
  }
}
