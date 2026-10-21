/**
 * The document tab's body: a Milkdown editor over one Markdown file.
 *
 * Responsibilities, in the order they happen:
 *
 *  1. read the file through this plugin's host channel (`open`), which is what
 *     issues the freshness token a save is checked against;
 *  2. mount the editor with the body Markdown (a YAML frontmatter block is kept
 *     aside verbatim, see `editor.js`);
 *  3. treat the serializer's output of the freshly parsed document as the
 *     baseline, so merely *opening* a file never rewrites it — Milkdown's
 *     round-trip normalises bullets, fences and table padding, and writing that
 *     back on load would reformat every file the user merely looked at;
 *  4. save when the user is *done*, never on a timer. There is deliberately no
 *     "typing stopped" auto-save: a timer that fires 900 ms into a sentence is
 *     what interrupts a Chinese IME composition, and every "the caret vanished
 *     after I typed" report traces back to something happening to the view while
 *     the user was still composing. The triggers are the ones the previous plugin
 *     was praised for:
 *       - Ctrl/Cmd+S;
 *       - the editor losing focus (leaving the document);
 *       - any pointer/key press outside the editor (clicking the chat box,
 *         switching conversation, pressing Enter to send);
 *       - the page being hidden or unloaded;
 *       - the view being torn down, before it is destroyed.
 *  5. answer a `conflict` (the file changed on disk) by *stopping* auto-writes and
 *     offering overwrite or reload, never by silently clobbering;
 *  6. reconcile the owner's `revision` **in place**. A revision change must never
 *     remount the editor: destroying the view drops focus and kills an in-flight
 *     composition, which is indistinguishable from "saving kicked me out".
 *
 * The owner contract is the shipped `loading: 'renderer'` one: the body is mounted
 * before any bytes are read and is handed `{ revision, loaded, failed, reload }`,
 * with `revision` as the only reload trigger.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addTablePart,
  flushPendingInput,
  joinFrontmatter,
  mountMilkdown,
  readMarkdown,
  replaceBody,
  splitFrontmatter,
  viewOf,
} from './editor.js';

/**
 * The reading position of each open document, keyed by address.
 *
 * Module level on purpose: the owner may remount the body when it reloads a tab
 * after a save, and a scroll offset kept in a ref would be gone with the component.
 * Reading position is part of "where I was in the document", so it has to survive
 * that remount.
 */
const scrollPositions = new Map();

/**
 * The body.
 * @param props - the keyed document slot's props.
 * @returns the editor, or a readable failure.
 */
export function MilkdownBody(props) {
  const { content, resourceAddress, wrap, call, t } = props;
  const address = typeof resourceAddress === 'string' ? resourceAddress : '';
  const revision = content?.kind === 'renderer' ? content.revision : undefined;

  const hostRef = useRef(null);
  const scrollRef = useRef(null);
  const mountRef = useRef(null);
  const editorRef = useRef(undefined);
  const viewRef = useRef(undefined);
  const docRef = useRef({ phase: 'loading' });
  /** Latest serialized body Markdown. */
  const markdownRef = useRef(undefined);
  /** Body Markdown last known to be on disk; the save baseline. */
  const baselineRef = useRef(undefined);
  /** Preserved frontmatter block, re-attached on save. */
  const frontRef = useRef('');
  /** True while the disk version is unknown (after a conflict or a failed save). */
  const pausedRef = useRef(false);
  const saveRef = useRef(undefined);
  /** The owner revision this body has already reconciled. */
  const loadedRevisionRef = useRef(undefined);
  /** True while an IME composition owns the buffer. */
  const composingRef = useRef(false);
  /** The table affordance's last placed value, so a no-op never re-renders. */
  const tableToolsRef = useRef(undefined);
  /** The table under the pointer, shown when the caret is elsewhere. */
  const hoveredTableRef = useRef(undefined);

  const [doc, setDoc] = useState({ phase: 'loading' });
  const [state, setState] = useState('idle');
  const [notice, setNotice] = useState(undefined);
  const [tableTools, setTableTools] = useState(undefined);

  /** Copy with a fallback, because a slot can be rendered before the locale binds. */
  const label = useCallback((key, fallback) => (typeof t === 'function' ? t(key) : fallback), [t]);

  /**
   * Write the buffer, unless it is already what the disk holds.
   * @param force - true skips the version guard (the user chose "overwrite").
   */
  const save = useCallback(
    async (force) => {
      const editor = editorRef.current;
      const held = docRef.current;
      if (editor === undefined || held.phase !== 'ready') return;
      if (held.writable !== true || typeof call !== 'function') return;
      // Guard against a rebinding race: the render that follows an address change
      // rebinds `saveRef` to the new document before the old effect's cleanup runs,
      // and without this check the old buffer would be written into the new file.
      if (held.address !== address) return;
      // Apply whatever the DOM observer is still holding before reading the buffer:
      // an IME commit or an automation `insertText` is not in the state yet.
      flushPendingInput(editor);
      const body = readMarkdown(editor) || markdownRef.current;
      markdownRef.current = body;
      if (force !== true && body === baselineRef.current) return;
      setState('saving');
      try {
        const result = await call('save', {
          address,
          content: joinFrontmatter(frontRef.current, body),
          // Undefined means "write whatever is there": only an explicit overwrite
          // is allowed to do that.
          baseVersion: force === true ? undefined : held.version,
          eol: held.eol,
          bom: held.bom,
        });
        if (result?.ok === true) {
          baselineRef.current = body;
          const next = { ...held, version: result.version, bytes: result.bytes };
          docRef.current = next;
          setDoc(next);
          pausedRef.current = false;
          setNotice(undefined);
          setState('saved');
          return;
        }
        pausedRef.current = true;
        if (result?.code === 'conflict') {
          setState('conflict');
          setNotice({ kind: 'conflict', current: result.current });
          return;
        }
        setState('error');
        // Keep the host's own message: a mapped code alone turns a precise
        // filesystem refusal into "something failed".
        setNotice({ kind: 'error', code: result?.code ?? 'unavailable', message: result?.message });
      } catch (error) {
        pausedRef.current = true;
        setState('error');
        setNotice({ kind: 'error', code: 'transport', message: String(error?.message ?? error) });
      }
    },
    [address, call],
  );
  saveRef.current = save;

  /** Adopt the editor's current document after a programmatic replacement. */
  const adoptCurrent = useCallback((version) => {
    const held = docRef.current;
    const next = { ...held, version };
    docRef.current = next;
    const initial = readMarkdown(editorRef.current);
    markdownRef.current = initial;
    baselineRef.current = initial;
    pausedRef.current = false;
    setDoc(next);
    setNotice(undefined);
    setState('saved');
  }, []);

  /** Adopt one serialized document as the buffer, and note it is unsaved. */
  const handleChange = useCallback((markdown, composing) => {
    markdownRef.current = markdown;
    if (docRef.current.phase !== 'ready') return;
    const dirty = markdown !== baselineRef.current;
    // The buffer is always current; the *indicator* can wait. Re-rendering React
    // while an IME composition is in flight is exactly the kind of side effect that
    // makes candidates vanish and commits the raw Latin keystrokes instead.
    if (composing === true) {
      composingRef.current = true;
      return;
    }
    composingRef.current = false;
    // Deliberately no save timer here: see the file header. The save happens on the
    // next "the user is done" event, and typing is never interrupted.
    setState(dirty ? (pausedRef.current ? 'conflict' : 'dirty') : 'saved');
  }, []);

  /** Place or clear the table affordance from the caret, or from the hovered table. */
  const positionTableTools = useCallback(() => {
    const scroll = scrollRef.current;
    const view = viewRef.current;
    // While an IME composition owns the editor, do nothing at all: not even a sibling
    // button may be re-rendered. The next selection change after the commit catches up.
    if (scroll === null || view === undefined || view.composing === true) return;
    const { $from } = view.state.selection;
    let table = null;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type.name !== 'table') continue;
      const dom = view.nodeDOM($from.before(depth));
      table = dom instanceof HTMLElement ? dom.closest('table') ?? dom : null;
      break;
    }
    if (table === null) table = hoveredTableRef.current ?? null;
    if (table === null || scroll.contains(table) === false) {
      if (tableToolsRef.current === undefined) return;
      tableToolsRef.current = undefined;
      setTableTools(undefined);
      return;
    }
    const scrollBox = scroll.getBoundingClientRect();
    const box = table.getBoundingClientRect();
    const next = {
      element: table,
      // Coordinates are inside the scroll container (which is the positioning
      // context), so the buttons travel with the table when it scrolls.
      top: box.top - scrollBox.top + scroll.scrollTop - 4,
      left: box.right - scrollBox.left + scroll.scrollLeft - 4,
    };
    const previous = tableToolsRef.current;
    if (
      previous !== undefined &&
      previous.element === next.element &&
      Math.abs(previous.top - next.top) < 1 &&
      Math.abs(previous.left - next.left) < 1
    ) {
      return;
    }
    tableToolsRef.current = next;
    setTableTools(next);
  }, []);

  // Read the file and mount the editor, once per address. Reloads do NOT re-run this:
  // see the revision effect below.
  useEffect(() => {
    if (address === '' || typeof call !== 'function') return undefined;
    // The save bound to *this* address. `saveRef.current` is rebound by the next
    // render, which happens before this effect's cleanup, so the teardown flush must
    // use the captured function or it writes the old buffer into the new file.
    const saveDocument = save;
    const controller = new AbortController();
    let cancelled = false;
    pausedRef.current = false;
    setState('idle');
    setNotice(undefined);
    setTableTools(undefined);
    docRef.current = { phase: 'loading' };
    setDoc(docRef.current);

    (async () => {
      let result;
      try {
        result = await call('open', { address }, controller.signal);
      } catch (error) {
        if (cancelled) return;
        content?.failed?.();
        docRef.current = { phase: 'error', code: 'transport', message: String(error?.message ?? error) };
        setDoc(docRef.current);
        return;
      }
      if (cancelled) return;
      if (result?.ok !== true) {
        content?.failed?.();
        docRef.current = { phase: 'error', code: result?.code ?? 'unavailable', message: result?.message };
        setDoc(docRef.current);
        return;
      }
      content?.loaded?.(result.version);
      loadedRevisionRef.current = revision;
      const parts = splitFrontmatter(result.text);
      frontRef.current = parts.front;
      const next = {
        phase: 'ready',
        address,
        absolutePath: result.absolutePath,
        path: result.path,
        version: result.version,
        eol: result.eol,
        bom: result.bom,
        bytes: result.bytes,
        writable: result.writable !== false,
        sandbox: result.sandbox,
      };
      docRef.current = next;
      setDoc(next);
      setState('saved');

      const mount = mountRef.current;
      if (mount === null || cancelled) return;
      mount.replaceChildren();
      try {
        const editor = await mountMilkdown({
          root: mount,
          markdown: parts.body,
          editable: next.writable,
          onChange: handleChange,
          onBlur: () => {
            void saveRef.current?.(false);
          },
        });
        if (cancelled) {
          void editor.destroy();
          return;
        }
        editorRef.current = editor;
        viewRef.current = viewOf(editor);
        const initial = readMarkdown(editor);
        markdownRef.current = initial;
        baselineRef.current = initial;
        // Put the reader back where they were. A remount (the owner reloading the tab
        // after a save) would otherwise drop them at the top of the document.
        const remembered = scrollPositions.get(address);
        const scroll = scrollRef.current;
        if (remembered !== undefined && scroll !== null) scroll.scrollTop = remembered;
      } catch (error) {
        if (cancelled) return;
        docRef.current = { ...next, phase: 'error', code: 'mount', message: String(error?.stack ?? error) };
        setDoc(docRef.current);
        setState('error');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      const held = docRef.current;
      const pending = markdownRef.current !== undefined && markdownRef.current !== baselineRef.current;
      if (held.phase === 'ready' && held.writable === true && pending) void saveDocument(false);
      const scroll = scrollRef.current;
      if (scroll !== null) scrollPositions.set(address, scroll.scrollTop);
      const editor = editorRef.current;
      editorRef.current = undefined;
      viewRef.current = undefined;
      loadedRevisionRef.current = undefined;
      markdownRef.current = undefined;
      baselineRef.current = undefined;
      if (editor !== undefined) void editor.destroy();
    };
    // `doc` is read through `docRef` on purpose: re-running on every edit would
    // re-open the file. The address is the only reason to rebuild the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Reconcile the owner's revision **without touching the view's identity**.
  useEffect(() => {
    if (revision === undefined || docRef.current.phase !== 'ready') return undefined;
    if (loadedRevisionRef.current === undefined) return undefined;
    if (loadedRevisionRef.current === revision) return undefined;
    loadedRevisionRef.current = revision;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      let result;
      try {
        result = await call('open', { address }, controller.signal);
      } catch {
        return;
      }
      if (cancelled || result?.ok !== true) return;
      const held = docRef.current;
      if (held.phase !== 'ready') return;
      content?.loaded?.(result.version);
      if (held.version === result.version) return;
      const editor = editorRef.current;
      if (editor === undefined) return;
      // Same reason as in `save`: the buffer may still be sitting in the DOM
      // observer, and deciding "clean" from a stale buffer would replace the words
      // the user just typed.
      flushPendingInput(editor);
      const buffer = readMarkdown(editor) || markdownRef.current;
      markdownRef.current = buffer;
      const dirty = buffer !== baselineRef.current;
      // Our own save coming back as a revision: adopt the token, change nothing else.
      if (dirty === false && joinFrontmatter(frontRef.current, buffer ?? '') === result.text) {
        const next = { ...held, version: result.version };
        docRef.current = next;
        setDoc(next);
        return;
      }
      if (dirty) {
        // The buffer wins: never overwrite what the user is typing. The strip offers
        // the disk version instead.
        setNotice({ kind: 'external' });
        return;
      }
      if (replaceBody(editor, splitFrontmatter(result.text).body) === true) {
        const scroll = scrollRef.current;
        const keep = scroll?.scrollTop;
        adoptCurrent(result.version);
        // Replacing the document can move the viewport (a caret change is a scroll
        // request); the reader did not move, so put them back where they were.
        if (scroll !== null && scroll !== undefined && keep !== undefined) scroll.scrollTop = keep;
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // Save points: Ctrl/Cmd+S, leaving the editor anywhere, and the page going away.
  // Nothing here runs while the user is typing, which is the whole point.
  useEffect(() => {
    const outside = (event) => {
      const view = viewRef.current;
      if (view !== undefined && event.target instanceof Node && view.dom.contains(event.target)) return;
      void saveRef.current?.(false);
    };
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        void saveRef.current?.(false);
        return;
      }
      outside(event);
    };
    const onPointerDown = (event) => outside(event);
    const flush = (force) => {
      if (force !== true && document.visibilityState !== 'hidden') return;
      void saveRef.current?.(false);
    };
    const onPageHide = () => flush(true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Keep the table buttons in step with the caret, the pointer and scrolling.
  //
  // Driven from DOM events rather than Milkdown's `selectionUpdated` listener: that
  // hook never fired in this build, and a document-level `selectionchange` is the same
  // signal the browser itself uses (it also covers clicks, arrow keys and drags).
  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll === null) return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        positionTableTools();
      });
    };
    const onMouseMove = (event) => {
      const target = event.target instanceof Element ? event.target.closest('table') : null;
      hoveredTableRef.current = target ?? undefined;
      schedule();
    };
    const onMouseLeave = () => {
      hoveredTableRef.current = undefined;
      schedule();
    };
    const onScroll = () => {
      const scroll = scrollRef.current;
      if (scroll !== null) scrollPositions.set(address, scroll.scrollTop);
      schedule();
    };
    scroll.addEventListener('mousemove', onMouseMove, { passive: true });
    scroll.addEventListener('mouseleave', onMouseLeave);
    scroll.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('selectionchange', schedule);
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      scroll.removeEventListener('mousemove', onMouseMove);
      scroll.removeEventListener('mouseleave', onMouseLeave);
      scroll.removeEventListener('scroll', onScroll);
      document.removeEventListener('selectionchange', schedule);
      window.removeEventListener('resize', onScroll);
    };
  }, [positionTableTools, address]);

  // Warn before the window closes with unsaved work; a save cannot finish while the
  // page is unloading, so this is the backstop, not the normal path.
  useEffect(() => {
    if (state !== 'dirty') return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state]);

  const wrapOn = wrap !== false;
  const stateText =
    doc.phase === 'loading'
      ? label('loading', '读取中…')
      : doc.writable === false
        ? label('readonly', '只读')
        : state === 'saving'
          ? label('saving', '保存中…')
          : state === 'dirty'
            ? label('unsaved', '未保存')
            : state === 'error'
              ? label('saveFailed', '保存失败')
              : state === 'conflict'
                ? label('conflictShort', '磁盘已变更')
                : label('saved', '已保存');

  const retry = () => {
    if (typeof content?.reload === 'function') content.reload();
  };

  /** Put the disk version into the editor, abandoning the buffer. */
  const loadDiskVersion = async () => {
    try {
      const result = await call('open', { address });
      const editor = editorRef.current;
      if (result?.ok !== true || editor === undefined) return;
      const parts = splitFrontmatter(result.text);
      const keep = scrollRef.current?.scrollTop;
      if (replaceBody(editor, parts.body) === false) return;
      adoptCurrent(result.version);
      frontRef.current = parts.front;
      const scroll = scrollRef.current;
      if (scroll !== null && scroll !== undefined && keep !== undefined) scroll.scrollTop = keep;
    } catch {
      /* the strip keeps showing the offer */
    }
  };

  return (
    <div ref={hostRef} className={`dsh-mk-root${wrapOn ? '' : ' dsh-mk-nowrap'}`}>
      {notice === undefined ? null : (
        <div className="dsh-mk-notice" data-kind={notice.kind}>
          <span className="dsh-mk-notice-text">
            {notice.kind === 'conflict'
              ? label('conflict', '磁盘上的文件已变更，保存被拒。')
              : notice.kind === 'external'
                ? label('external', '磁盘上的文件已被外部修改。')
                : `${label('saveFailed', '保存失败')}：${notice.message ?? notice.code ?? ''}`}
          </span>
          {notice.kind === 'conflict' ? (
            <>
              <button className="dsh-mk-button" type="button" onClick={() => void saveRef.current?.(true)}>
                {label('overwrite', '覆盖磁盘')}
              </button>
              <button className="dsh-mk-button" type="button" onClick={retry}>
                {label('reload', '重新加载')}
              </button>
            </>
          ) : notice.kind === 'external' ? (
            <>
              <button className="dsh-mk-button" type="button" onClick={() => void loadDiskVersion()}>
                {label('loadDisk', '载入磁盘版本')}
              </button>
              <button className="dsh-mk-button" type="button" onClick={() => setNotice(undefined)}>
                {label('keepMine', '保留我的修改')}
              </button>
            </>
          ) : (
            <button className="dsh-mk-button" type="button" onClick={() => void saveRef.current?.(false)}>
              {label('retry', '重试')}
            </button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="dsh-mk-scroll">
        {doc.phase === 'error' ? (
          <div className="dsh-mk-center" data-kind="error">
            {`${label('error', '打开失败')}：${describeFailure(doc, label)}\n\n${label('switchBack', '可在工具栏下拉里切回官方预览。')}`}
            {typeof content?.reload === 'function' ? (
              <div style={{ marginTop: '10px' }}>
                <button className="dsh-mk-button" type="button" onClick={retry}>
                  {label('retry', '重试')}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {doc.phase === 'loading' ? <div className="dsh-mk-center">{label('loading', '读取中…')}</div> : null}
            <div className="dsh-mk-pad">
              {/* React owns this element and nothing inside it: the editor replaces
                  its children itself, and a React-rendered child here would be
                  removed from under the contenteditable on the next render. */}
              <div ref={mountRef} />
            </div>
          </>
        )}
        {tableTools === undefined ? null : (
          <div
            className="dsh-mk-table-tools"
            style={{ top: `${tableTools.top}px`, left: `${tableTools.left}px`, transform: 'translate(-100%, -100%)' }}
            // The buttons must not take the caret out of the table they act on.
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              className="dsh-mk-button"
              type="button"
              title={label('addRowHint', '在表格末尾加一行；Tab 也可以')}
              onClick={() => {
                if (editorRef.current !== undefined) addTablePart(editorRef.current, 'row', tableTools.element);
              }}
            >
              {label('addRow', '＋ 行')}
            </button>
            <button
              className="dsh-mk-button"
              type="button"
              title={label('addColumnHint', '在表格右侧加一列')}
              onClick={() => {
                if (editorRef.current !== undefined) addTablePart(editorRef.current, 'column', tableTools.element);
              }}
            >
              {label('addColumn', '＋ 列')}
            </button>
          </div>
        )}
      </div>

      <div className="dsh-mk-foot">
        <span className="dsh-mk-foot-path" title={doc.absolutePath ?? address}>
          {doc.absolutePath ?? doc.path ?? address}
        </span>
        <span className="dsh-mk-foot-state" data-state={state}>
          {stateText}
        </span>
        {doc.writable === false ? (
          <span className="dsh-mk-foot-state" data-state="readonly">
            {label('readonlyOutside', '只读（工作区外）')}
          </span>
        ) : null}
        <button
          className="dsh-mk-button"
          type="button"
          title={label('saveHint', 'Ctrl/Cmd+S')}
          disabled={state !== 'dirty' || doc.writable === false}
          onClick={() => void saveRef.current?.(false)}
        >
          {label('save', '保存')}
        </button>
      </div>
    </div>
  );
}

/**
 * Turn a failure record into one line a reader can act on.
 * @param doc - the body's document state.
 * @param label - the bound copy function.
 * @returns the message to show.
 */
function describeFailure(doc, label) {
  switch (doc.code) {
    case 'too-large':
      return label('tooLarge', '文件超过上限（2 MB）。');
    case 'outside-workspace':
      return label('outsideWorkspace', '该文件不在会话工作区内。');
    case 'unknown-session':
      return label('unknownSession', '找不到对应会话。');
    case 'not-text':
      return label('notText', '不是文本文件。');
    case 'not-found':
      return label('notFound', '文件不存在。');
    case 'unsupported-address':
      return label('unsupportedAddress', '文件地址无法解析。');
    case 'unavailable':
      return label('unavailable', '文件服务不可用。');
    case 'mount':
      return `${label('mountFailed', '编辑器挂载失败')}\n${doc.message ?? ''}`;
    case 'transport':
      return label('transport', '与主进程通信失败。');
    default:
      return `${doc.code ?? ''} ${doc.message ?? ''}`.trim();
  }
}
