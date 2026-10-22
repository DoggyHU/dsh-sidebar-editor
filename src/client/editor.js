/**
 * The editor itself: one ProseMirror document, one view, Markdown on both sides.
 *
 * This file is deliberately the only place that knows Milkdown exists. The React
 * body hands it a DOM element and a Markdown string, and asks it a few things —
 * "what is the Markdown now?", "replace the document", "add a table row" — so every
 * ProseMirror import stays in one file and the body can stay about the file.
 *
 * Everything that used to be a bug in the CodeMirror-based plugin (`<br>` written to
 * disk, IME composition landing in a node a re-render replaced, selections clamped
 * at block borders) belongs to the editor's own model here, so there is nothing for
 * us to arbitrate.
 *
 * Milkdown's defaults are used for everything except:
 *
 *  - the editing host's attributes and type scale, which follow the app's own
 *    Markdown font tokens (see `theme.js`) so the editor tracks the user's font
 *    settings exactly like the shipped preview does;
 *  - `editable`, so a file outside the workspace opens read-only;
 *  - the markdown listener, which is how the body learns it has unsaved changes;
 *  - serializer punctuation, so a `-`/`---` file is not rewritten into `*`/`***`;
 *  - Enter/Shift+Enter, so a line break is always a new block, never a `<br>`.
 */
import {
  Editor,
  commandsCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { commonmark, remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark';
import { addColAfterCommand, addRowAfterCommand, gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { newlineInCode, setBlockType, splitBlock } from '@milkdown/kit/prose/commands';
import { splitListItem } from '@milkdown/kit/prose/schema-list';
import { TextSelection } from '@milkdown/kit/prose/state';

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
 * Split a leading YAML frontmatter block off a Markdown file.
 *
 * The schema has no node for frontmatter, and round-tripping would turn `---` into a
 * horizontal rule and mangle the keys. A document that has one is therefore edited
 * as its body, with the block carried through the plugin verbatim and re-joined on
 * save, so opening an Obsidian note cannot destroy its metadata.
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
 * @param options - `{ root, markdown, editable, onChange, onBlur }`.
 * @param options.root - element to own the editing host; its children are replaced.
 * @param options.markdown - initial body Markdown (frontmatter already stripped).
 * @param options.editable - false renders a read-only document.
 * @param options.onChange - called with the serialized Markdown after every doc change.
 * @param options.onBlur - called once when the editing host loses focus.
 * @returns the created `Editor`.
 */
export async function mountMilkdown({ root, markdown, editable = true, onChange, onBlur }) {
  const mountedEditable = editable !== false;
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.set(editorViewOptionsCtx, {
        // A function, not a value: a save refused by the sandbox can flip the document
        // to read-only, and the view has to follow without a remount.
        editable: () => mountedEditable,
        attributes: {
          class: 'dsh-se-prose dsh-se-surface',
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
      manager.markdownUpdated((innerCtx, next) => {
        if (typeof onChange !== 'function') return;
        // Whether an IME composition is in flight travels with every change: the body
        // must not re-render in the middle of one (see its header).
        const composing = innerCtx.get(editorViewCtx)?.composing === true;
        onChange(next, composing);
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
  attachDebugHandle(editor, root);
  return editor;
}

/**
 * The ProseMirror view behind an editor.
 * @param editor - a created editor.
 * @returns the view, or `undefined` when the editor is not usable.
 */
export function viewOf(editor) {
  try {
    return editor.action((ctx) => ctx.get(editorViewCtx));
  } catch {
    return undefined;
  }
}

/**
 * Expose the editor on its root element for the browser test harness.
 *
 * The harness has to tell a DOM selection from the document selection, and there is
 * no honest way to ask through the DOM. Off unless the page opts in.
 * @param editor - a created editor.
 * @param root - the element the editor was mounted into.
 */
function attachDebugHandle(editor, root) {
  if (globalThis.__DSH_MILKDOWN_DEBUG__ !== true) return;
  try {
    root.dshMilkdownEditor = editor;
    root.dshMilkdownView = viewOf(editor);
  } catch {
    /* the handle is a convenience, never a requirement */
  }
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
 * Replace the whole document in place.
 *
 * Used when the file on disk changed under us and the buffer is clean. This is why
 * the body never remounts the editor for a reload: destroying and recreating the
 * view drops focus, which ends an IME composition and looks exactly like the editor
 * "kicking the user out" after every save. The caret is kept near where it was —
 * parking it at the start would scroll the sidebar back to the top of the document
 * on every save, which is its own kind of "it moved by itself".
 * @param editor - a created editor.
 * @param markdown - the body Markdown to load.
 * @returns true when the document was replaced.
 */
export function replaceBody(editor, markdown) {
  try {
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const parse = ctx.get(parserCtx);
      const next = parse(markdown);
      const { state } = view;
      const keep = state.selection.from;
      const transaction = state.tr.replaceWith(0, state.doc.content.size, next.content);
      const limit = transaction.doc.content.size;
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(keep, limit))));
      view.dispatch(transaction);
      return true;
    });
  } catch (error) {
    // A reload that cannot be applied is worth seeing: silence here means a document
    // that quietly stops following the file.
    console.error('[dsh-sidebar-editor] replacing the document failed', error);
    return false;
  }
}

/**
 * Force any pending DOM-level edit into the document.
 *
 * ProseMirror batches DOM mutations through its DOM observer (a `setTimeout` tick),
 * so an edit that arrived at the DOM rather than through a key handler — an IME
 * commit, or `insertText` from an automation API — can still be un-applied when a
 * save reads the state. Saving one keystroke behind is exactly the kind of "I saved
 * and it lost my last character" that is impossible to explain afterwards.
 *
 * `forceFlush` is the same call ProseMirror makes before reading a selection; it is
 * not in the public typings, so it is guarded.
 * @param editor - a created editor.
 */
export function flushPendingInput(editor) {
  try {
    viewOf(editor)?.domObserver?.forceFlush?.();
  } catch {
    /* a missing internal is not worth failing a save over */
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

/**
 * Whether the caret is inside the given table element.
 * @param view - the ProseMirror view.
 * @param table - a `<table>` element taken from the editor's DOM.
 * @returns true when the selection sits inside that table.
 */
export function selectionInTable(view, table) {
  if (view === undefined || table === null || table === undefined) return false;
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== 'table') continue;
    const dom = view.nodeDOM($from.before(depth));
    const element = dom instanceof HTMLElement ? dom.closest('table') ?? dom : null;
    return element === table;
  }
  return false;
}

/**
 * Add a row or a column to a table.
 *
 * `prosemirror-tables` ships commands but no UI, and its commands work on the current
 * selection. A table that is merely hovered therefore gets the caret placed in its
 * last cell first, so the button means "this table" rather than "wherever the caret
 * happened to be" — the same affordance the old plugin's ＋行/＋列 buttons had.
 *
 * Tab at the last cell already appends a row (`goToNextCell`), so this is for the
 * mouse, not the only way to grow a table.
 * @param editor - a created editor.
 * @param kind - `'row'` or `'column'`.
 * @param table - the table element the button belongs to.
 * @returns true when a command reported success.
 */
export function addTablePart(editor, kind, table) {
  const view = viewOf(editor);
  if (view === undefined || table === null || table === undefined) return false;
  try {
    if (selectionInTable(view, table) === false) {
      const rows = table.rows;
      const lastRow = rows[rows.length - 1];
      const lastCell = lastRow?.cells?.[lastRow.cells.length - 1];
      if (lastCell === undefined) return false;
      const inside = view.posAtDOM(lastCell, 0);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inside)));
    }
    editor.action((ctx) => {
      const commands = ctx.get(commandsCtx);
      commands.call(kind === 'row' ? addRowAfterCommand.key : addColAfterCommand.key);
    });
    view.focus();
    return true;
  } catch {
    return false;
  }
}
