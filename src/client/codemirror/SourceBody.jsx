/**
 * The code view: CodeMirror 6 over one text file.
 *
 * Lifted from the retired `dsh-sidebar-editor` plugin's editor body, with the
 * rendered-Markdown route removed. What is left is the part that never caused
 * trouble: a plain text editor whose buffer *is* the file, so nothing has to be
 * serialized on the way in or out.
 *
 * Editing model, deliberately identical to the rich text view so that one file
 * behaves the same way in both:
 *
 *  - **no auto-save timer.** The save points are Ctrl/Cmd+S, the editor losing
 *    focus, any pointer/key press outside the editor, the page being hidden or
 *    unloaded, and the view being torn down. A timer firing into a half-typed
 *    sentence is what makes a save correlate with "something happened to my
 *    cursor", and it also means two views of one file write at different rhythms;
 *  - **no drafts.** The save points cover every exit path, so a localStorage copy
 *    would only add a second source of truth;
 *  - a `conflict` (the file changed on disk) stops non-forced writes and offers
 *    overwrite / reload instead of clobbering;
 *  - the owner's `revision` is reconciled **in place**: same bytes adopt the new
 *    token and keep the cursor, different bytes either replace a clean buffer or
 *    become a notice while the user's edits are unsaved.
 *
 * The owner contract is the shipped `loading: 'renderer'` one: the body is
 * mounted before any bytes are read and is handed `{ revision, loaded, failed,
 * reload }`, with `revision` as the only reload trigger.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { fileNameOf, pathOfFileAddress } from '../address.js';
import { languageForPath, suffixOf } from './languages.js';
import { chromeTheme, isDarkTheme, observeTheme, shellHighlighting } from './theme.js';
import { enqueueWrite, whenIdle } from '../write-queue.js';

/** Copy used only if the locale namespace is somehow not bound yet. */
const FALLBACK = {
  loading: '读取中…',
  saving: '保存中…',
  saved: '已保存',
  unsaved: '未保存',
  save: '保存',
  saveHint: 'Ctrl/Cmd+S',
  retry: '重试',
  overwrite: '覆盖磁盘',
  reload: '重新加载',
  conflict: '磁盘上的文件已变更，保存被拒。',
  external: '磁盘上的文件已被外部修改（你的修改还没保存）。',
  loadDisk: '载入磁盘版本',
  keepMine: '保留我的修改',
  error: '打开失败',
  mountFailed: '编辑器挂载失败',
  tooLarge: '文件超过编辑器上限（2 MB）。',
  outsideWorkspace: '该文件不在会话工作区内。',
  unknownSession: '找不到对应会话，无法读写。',
  notText: '不是文本文件。',
  notFound: '文件不存在。',
  unavailable: '文件服务不可用。',
  unsupportedAddress: '文件地址无法解析。',
  sandboxDenied: '沙箱策略拒绝写入该文件。',
  sandboxBlocked: '沙箱策略为只读，保存会被拒绝。',
  transport: '与主进程通信失败。',
  readonly: '只读',
  readonlyOutside: '只读（工作区外）',
  linesUnit: '行',
};

/**
 * Human byte size for the status bar.
 * @param size - byte length.
 * @returns a short label.
 */
function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** The copy key for one host failure code. */
function keyForCode(code) {
  switch (code) {
    case 'too-large':
      return 'tooLarge';
    case 'outside-workspace':
      return 'outsideWorkspace';
    case 'unknown-session':
      return 'unknownSession';
    case 'not-text':
      return 'notText';
    case 'not-found':
      return 'notFound';
    case 'unavailable':
      return 'unavailable';
    case 'unsupported-address':
      return 'unsupportedAddress';
    case 'sandbox-denied':
      return 'sandboxDenied';
    default:
      return 'transport';
  }
}

/**
 * Human copy for a failure code, keeping an unmapped code visible.
 *
 * A code this build does not know is still the most useful thing on screen: it
 * survives into a bug report, where "未知错误" does not.
 */
function codeLabel(t, code) {
  if (typeof code !== 'string' || code === '') return t('transport');
  const key = keyForCode(code);
  return key === 'transport' && code !== 'transport' ? `${t(key)} [${code}]` : t(key);
}

/**
 * The body.
 * @param props - the keyed document slot's props plus the bound host caller.
 * @returns the editor, or a readable failure.
 */
export function SourceBody(props) {
  const { content, resourceAddress, wrap, scrollportRef, call } = props;
  const address = typeof resourceAddress === 'string' ? resourceAddress : '';
  const revision = content?.kind === 'renderer' ? content.revision : undefined;
  const path = useMemo(() => pathOfFileAddress(address) ?? address, [address]);

  /** Copy with a fallback, because a slot can render before the locale binds. */
  const t = useCallback(
    (key) => {
      if (typeof props.t === 'function') return props.t(key);
      return FALLBACK[key] ?? key;
    },
    [props.t],
  );

  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const docRef = useRef({ phase: 'loading' });
  const saveRef = useRef(undefined);
  /** The owner revision this body has already reconciled. */
  const loadedRevisionRef = useRef(undefined);
  /** True while the disk version is unknown (after a conflict or a failed save). */
  const pausedRef = useRef(false);

  const [doc, setDoc] = useState({ phase: 'loading' });
  const [state, setState] = useState('idle');
  const [notice, setNotice] = useState(undefined);
  const [flash, setFlash] = useState(undefined);
  const [mountError, setMountError] = useState(undefined);
  const [dark, setDark] = useState(() => isDarkTheme());

  const compartmentsRef = useRef(null);
  if (compartmentsRef.current === null) {
    compartmentsRef.current = {
      language: new Compartment(),
      wrap: new Compartment(),
      theme: new Compartment(),
    };
  }
  const compartments = compartmentsRef.current;

  /**
   * Write one text, unless it is already what the disk holds.
   *
   * Takes the text as an argument rather than reading the view, so the teardown
   * path can still persist what it captured *before* the view was destroyed.
   * @param text - the buffer to write.
   * @param force - true skips the version guard (the user chose "overwrite").
   */
  const saveText = useCallback(
    async (text, force) => {
      const held = docRef.current;
      if (held.phase !== 'ready') return;
      if (held.writable !== true || typeof call !== 'function') return;
      // Guard against a rebinding race: the render that follows an address change
      // rebinds `saveRef` to the new document before the old effect's cleanup runs,
      // and without this check the old buffer would be written into the new file.
      if (held.address !== address) return;
      if (force !== true && text === held.base) return;
      if (force !== true && pausedRef.current === true) return;
      setState('saving');
      try {
        const result = await call('save', {
          address,
          content: text,
          // Undefined means "write whatever is there": only an explicit overwrite
          // is allowed to do that.
          baseVersion: force === true ? undefined : held.version,
          eol: held.eol,
          bom: held.bom,
        });
        if (result?.ok === true) {
          // The user may have kept typing while the write was in flight, so the
          // baseline is the written text but the buffer is whatever the view holds.
          const view = viewRef.current;
          const current = view === null ? text : view.state.doc.toString();
          const next = {
            ...docRef.current,
            base: text,
            text: current,
            version: result.version,
            bytes: result.bytes,
          };
          docRef.current = next;
          pausedRef.current = false;
          setDoc(next);
          setNotice(undefined);
          setState(current === text ? 'saved' : 'dirty');
          setFlash('saved');
          return;
        }
        if (result?.code === 'conflict') {
          // A stale token is not always someone else's edit: the same write can have
          // landed already (a queued save, or the owner's reload raising the version
          // first). If the disk holds exactly what we were about to write, this is
          // success — reporting a conflict there refused to save a document whose
          // newest bytes were already on disk.
          if (typeof result.current?.text === 'string' && result.current.text === text) {
            const next = {
              ...docRef.current,
              base: text,
              text,
              version: result.current?.version ?? docRef.current.version,
            };
            docRef.current = next;
            pausedRef.current = false;
            setDoc(next);
            setNotice(undefined);
            setState('saved');
            setFlash('saved');
            return;
          }
          pausedRef.current = true;
          setState('conflict');
          setNotice({ kind: 'conflict', current: result.current });
          return;
        }
        // A failure that is not a conflict leaves the version token valid: only the
        // write failed (sandbox, transport, too large). Pausing would silently turn the
        // save button into a no-op, so keep saves armed and offer a retry instead.
        pausedRef.current = false;
        setState('error');
        // Keep the host's own message: a mapped code alone turns a precise
        // filesystem refusal into "something failed".
        setNotice({ kind: 'error', code: result?.code ?? 'unavailable', message: result?.message });
      } catch (error) {
        pausedRef.current = false;
        setState('error');
        setNotice({ kind: 'error', code: 'transport', message: String(error?.message ?? error) });
      }
    },
    [address, call],
  );

  /**
   * Queue one write behind any write already queued for this address.
   *
   * The queue is module level and shared with the rich text view, so a teardown write
   * from the other view is ordered before this view's first read (see write-queue.js).
   */
  const enqueue = useCallback((text, force) => enqueueWrite(address, () => saveText(text, force)), [address, saveText]);

  /** Save the live buffer. */
  const save = useCallback(
    (force) => {
      const view = viewRef.current;
      if (view === null) return Promise.resolve();
      return enqueue(view.state.doc.toString(), force);
    },
    [enqueue],
  );
  saveRef.current = save;

  /** Adopt a freshly read file as the new baseline. */
  const applyRead = useCallback(
    (result, options = {}) => {
      const view = viewRef.current;
      if (view !== null && options.replace === true && view.state.doc.toString() !== result.text) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result.text } });
      }
      const current = view === null ? result.text : view.state.doc.toString();
      // A conflict payload carries only the bytes and the token, so anything it omits
      // is taken from what this body already knew — otherwise a "reload" would drop the
      // absolute path, the size and the read-only flag, and the status bar with them.
      const previous = docRef.current;
      const next = {
        ...previous,
        phase: 'ready',
        address,
        text: current,
        base: result.text,
        version: result.version,
        eol: result.eol ?? previous.eol,
        bom: result.bom ?? previous.bom,
        absolutePath: result.absolutePath ?? previous.absolutePath,
        path: result.path ?? previous.path,
        bytes: result.bytes ?? previous.bytes,
        writable: typeof result.writable === 'boolean' ? result.writable : previous.writable === true,
        sandbox: result.sandbox ?? previous.sandbox,
      };
      docRef.current = next;
      pausedRef.current = false;
      setDoc(next);
      setNotice(undefined);
      setState(current === result.text ? 'saved' : 'dirty');
    },
    [address],
  );

  // Read the file and mount the editor, once per address. Reloads do NOT re-run
  // this: see the revision effect below.
  useEffect(() => {
    if (address === '' || typeof call !== 'function') return undefined;
    // The writer bound to *this* address. `saveRef.current` is rebound by the next
    // render, which happens before this effect's cleanup, so the teardown flush must
    // use the captured function or it writes the old buffer into the new file.
    const saveDetached = enqueue;
    const controller = new AbortController();
    let cancelled = false;
    pausedRef.current = false;
    setState('idle');
    setNotice(undefined);
    setMountError(undefined);
    docRef.current = { phase: 'loading' };
    setDoc(docRef.current);
    setDark(isDarkTheme());

    (async () => {
      // Never read while this file still has a queued write: switching the view in the
      // dropdown is exactly this situation (the other body's teardown write).
      await whenIdle(address);
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
      const next = {
        phase: 'ready',
        address,
        text: result.text,
        base: result.text,
        version: result.version,
        eol: result.eol,
        bom: result.bom,
        absolutePath: result.absolutePath,
        path: result.path,
        bytes: result.bytes,
        writable: result.writable !== false,
        sandbox: result.sandbox,
      };
      docRef.current = next;
      setDoc(next);
      setState('saved');

      const host = hostRef.current;
      if (host === null || cancelled) return;
      host.replaceChildren();
      try {
        const view = new EditorView({
          parent: host,
          state: EditorState.create({
            doc: result.text,
            extensions: [
              lineNumbers(),
              highlightActiveLineGutter(),
              highlightActiveLine(),
              foldGutter(),
              history(),
              drawSelection(),
              rectangularSelection(),
              crosshairCursor(),
              indentOnInput(),
              bracketMatching(),
              highlightSelectionMatches(),
              keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
              shellHighlighting,
              // A file outside the session workspace opens read-only: the host would
              // refuse the write, so the editor must not pretend otherwise.
              EditorState.readOnly.of(next.writable === false),
              EditorView.editable.of(next.writable !== false),
              // Leaving the editor is a save point, the same one the rich text view
              // has. CodeMirror's scroller fills the pane, so "clicked outside" is not
              // always outside the editor — blur is what catches focus moving away.
              EditorView.domEventHandlers({
                blur: () => {
                  void saveRef.current?.(false);
                },
              }),
              EditorView.updateListener.of((update) => {
                if (update.docChanged !== true) return;
                const base = docRef.current.base ?? '';
                const changed = update.state.doc.toString() !== base;
                setState(changed ? (pausedRef.current === true ? 'conflict' : 'dirty') : 'saved');
              }),
              compartments.language.of(languageForPath(path) ?? []),
              compartments.wrap.of(wrap !== false ? EditorView.lineWrapping : []),
              compartments.theme.of(chromeTheme(dark)),
            ],
          }),
        });
        viewRef.current = view;
        // Hand the scroller to the owner so its own scroll restore and bookkeeping
        // follow this element instead of the shared body element.
        if (typeof scrollportRef === 'function') scrollportRef(view.scrollDOM);
      } catch (error) {
        if (cancelled) return;
        setMountError(String(error?.stack ?? error));
        setState('error');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      const view = viewRef.current;
      const held = docRef.current;
      let pending;
      if (view !== null) {
        const text = view.state.doc.toString();
        if (held.phase === 'ready' && held.writable === true && text !== held.base) pending = text;
      }
      viewRef.current = null;
      loadedRevisionRef.current = undefined;
      if (typeof scrollportRef === 'function') scrollportRef(null);
      if (view !== null) view.destroy();
      // Synchronous capture above, asynchronous write below: the view is already
      // gone, so this uses the text taken before it was destroyed.
      if (pending !== undefined) void saveDetached(pending, false);
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
      // Never read while this file still has a queued write: switching the view in the
      // dropdown is exactly this situation (the other body's teardown write).
      await whenIdle(address);
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
      const view = viewRef.current;
      if (view === null) return;
      const buffer = view.state.doc.toString();
      const dirty = buffer !== held.base;
      // Our own save coming back as a revision: adopt the token, change nothing else.
      if (dirty === false && result.text === buffer) {
        const next = { ...held, version: result.version, bytes: result.bytes };
        docRef.current = next;
        setDoc(next);
        return;
      }
      if (dirty) {
        // The buffer wins: never overwrite what the user is typing. The strip offers
        // the disk version (or keeping the edits) instead — it needs the freshly read
        // record for that, not just the fact that something changed.
        setNotice({ kind: 'external', current: result });
        return;
      }
      applyRead(result, { replace: true });
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
      if (view !== null && event.target instanceof Node && view.dom.contains(event.target)) return;
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

  // Follow the shell's theme switch without importing the theme service.
  useEffect(() => observeTheme(() => setDark(isDarkTheme())), []);

  // The wrap preference belongs to the owner's toolbar; follow it live.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      effects: compartments.wrap.reconfigure(wrap !== false ? EditorView.lineWrapping : []),
    });
  }, [wrap, compartments]);

  // A body can be reused for another path (same tab, another file): recolour.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({ effects: compartments.language.reconfigure(languageForPath(path) ?? []) });
  }, [path, compartments]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({ effects: compartments.theme.reconfigure(chromeTheme(dark)) });
  }, [dark, compartments]);

  useEffect(() => {
    if (flash === undefined) return undefined;
    const timer = setTimeout(() => setFlash(undefined), 1600);
    return () => clearTimeout(timer);
  }, [flash]);

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

  const lineCount = doc.phase === 'ready' ? (viewRef.current?.state.doc.lines ?? (doc.text ?? '').split('\n').length) : 0;
  const suffix = suffixOf(path);

  const actionButton = (label, onClick, primary) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: '0 0 auto',
        padding: '2px 8px',
        borderRadius: 'var(--dsw-radius-sm, 4px)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
        background: primary === true ? 'var(--dsw-alias-brand-primary, #1c2024)' : 'transparent',
        color: primary === true ? 'var(--dsw-alias-label-primary-foreground, #ffffff)' : 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      {t(label)}
    </button>
  );

  /** Strip above the editor: conflicts, external changes, sandbox refusals, failures. */
  const banner = (() => {
    if (notice === undefined) {
      // A read-only sandbox refuses every write. Better to say it here than to let the
      // user type and lose the save — and better than a bare refusal later.
      if (doc.phase === 'ready' && doc.sandbox?.allowsWrite === false) {
        return {
          text: `${t('sandboxBlocked')}${doc.sandbox.mode === undefined ? '' : `（${doc.sandbox.mode}）`}`,
          actions: null,
        };
      }
      return null;
    }
    if (notice.kind === 'conflict' || notice.kind === 'external') {
      return {
        text: notice.kind === 'conflict' ? t('conflict') : t('external'),
        actions: (
          <>
            {actionButton('overwrite', () => void save(true), false)}
            {notice.current === undefined
              ? null
              : actionButton(
                  'reload',
                  () => {
                    applyRead(notice.current, { replace: true });
                  },
                  true,
                )}
            {/* Dismissing is only honest for an external change: the edits are still
                there and the disk version is not what the user wants. A conflict has no
                dismiss, because the version token is stale until one of the two above. */}
            {notice.kind === 'external'
              ? actionButton(
                  'keepMine',
                  () => {
                    pausedRef.current = false;
                    setNotice(undefined);
                  },
                  false,
                )
              : null}
          </>
        ),
      };
    }
    return {
      text: `${t('error')}：${codeLabel(t, notice.code)}`,
      detail: typeof notice.message === 'string' && notice.message !== '' ? notice.message : undefined,
      // The token is still valid, so retrying is a plain save (see saveText's error
      // branch); without this the strip would be a dead end.
      actions: doc.phase === 'ready' && doc.writable !== false ? actionButton('retry', () => void save(false), false) : null,
    };
  })();

  return (
    <div
      className="dsh-src-root"
      style={{
        flex: '1 1 auto',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        // The code surface keeps the shipped preview's own background: the rich text
        // view sits on `bg-base` because it is a page of paper, a code surface is not.
        background: 'var(--dsw-alias-bg-document-preview, var(--dsw-alias-bg-base, transparent))',
        color: 'var(--dsw-alias-label-primary, #1c2024)',
      }}
    >
      {banner === null ? null : (
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 10px',
            background: 'var(--dsw-alias-state-warn-tertiary, rgba(245, 158, 11, 0.12))',
            color: 'var(--dsw-alias-state-warn-label, #dd8629)',
            fontSize: '11px',
            whiteSpace: 'normal',
          }}
        >
          <span style={{ flex: '1 1 auto', minWidth: 0 }}>
            {banner.text}
            {banner.detail === undefined ? null : (
              <span
                title={banner.detail}
                style={{
                  display: 'block',
                  marginTop: '2px',
                  color: 'var(--dsw-alias-label-tertiary, #98a2b3)',
                  fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
                  wordBreak: 'break-word',
                }}
              >
                {banner.detail}
              </span>
            )}
          </span>
          {banner.actions}
        </div>
      )}
      {mountError === undefined ? null : (
        <div
          style={{
            flex: '0 0 auto',
            padding: '8px 10px',
            fontSize: '12px',
            color: 'var(--dsw-alias-state-error-primary, #ef4444)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {t('mountFailed')}: {mountError}
        </div>
      )}
      {/*
        The CodeMirror host is rendered unconditionally, even while the file is still
        loading. The mount runs in a continuation right after the state that says
        "ready", which can land before React has committed that render: a host that only
        exists in the ready branch is then still null, the mount is skipped silently, and
        the pane stays blank with no error. The loading and failure states therefore
        overlay it instead of replacing it.
      */}
      <div style={{ position: 'relative', display: 'flex', flex: '1 1 auto', flexDirection: 'column', minHeight: 0 }}>
        <div ref={hostRef} className="dsh-src-host" style={{ flex: '1 1 auto', minHeight: 0, minWidth: 0, overflow: 'hidden' }} />
        {doc.phase === 'ready' ? null : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              padding: '24px',
              textAlign: 'center',
              color: 'var(--dsw-alias-label-secondary, #61666b)',
              background: 'var(--dsw-alias-bg-document-preview, var(--dsw-alias-bg-base, transparent))',
            }}
          >
            <span>{doc.phase === 'loading' ? t('loading') : `${t('error')}：${codeLabel(t, doc.code)}`}</span>
            {doc.phase === 'error' && typeof doc.message === 'string' && doc.message !== '' ? (
              <span
                style={{
                  maxWidth: '36em',
                  color: 'var(--dsw-alias-label-tertiary, #98a2b3)',
                  fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)',
                  wordBreak: 'break-word',
                }}
              >
                {doc.message}
              </span>
            ) : null}
            {doc.phase === 'error' && typeof content?.reload === 'function'
              ? actionButton(
                  'retry',
                  () => {
                    setDoc({ phase: 'loading' });
                    content.reload();
                  },
                  false,
                )
              : null}
          </div>
        )}
      </div>
      <div
        className="dsh-src-foot"
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          height: '22px',
          padding: '0 10px 0 12px',
          borderTop: '1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06))',
          color: 'var(--dsw-alias-label-tertiary, #98a2b3)',
          fontSize: '11px',
          fontFamily: 'var(--dsw-font-family, inherit)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span title={path} style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', minWidth: 0 }}>
          {path === '' ? '' : fileNameOf(path)}
        </span>
        {suffix === undefined ? null : <span>{suffix}</span>}
        {doc.phase === 'ready' ? <span>{`${lineCount} ${t('linesUnit')}`}</span> : null}
        {doc.bytes === undefined ? null : <span>{formatBytes(doc.bytes)}</span>}
        {doc.eol === 'crlf' ? <span>CRLF</span> : null}
        {doc.bom === true ? <span>BOM</span> : null}
        <span style={{ flex: '1 1 auto' }} />
        {flash === 'saved' ? (
          <span style={{ flex: '0 0 auto', color: 'var(--dsw-alias-state-success-primary, #22c55e)' }}>{t('saved')}</span>
        ) : null}
        {state === 'saving' ? <span style={{ flex: '0 0 auto' }}>{t('saving')}</span> : null}
        {state === 'dirty' || state === 'conflict' ? (
          <span
            style={{
              flex: '0 0 auto',
              color:
                state === 'conflict'
                  ? 'var(--dsw-alias-state-error-primary, #ef4444)'
                  : 'var(--dsw-alias-state-warn-label, #dd8629)',
            }}
          >
            ● {t('unsaved')}
          </span>
        ) : null}
        {doc.writable === false ? (
          <span style={{ flex: '0 0 auto', color: 'var(--dsw-alias-label-secondary, #61666b)' }}>{t('readonlyOutside')}</span>
        ) : null}
        {doc.phase === 'ready' && doc.writable !== false ? (
          <button
            type="button"
            disabled={state === 'saving'}
            onClick={() => void save(false)}
            title={t('saveHint')}
            style={{
              flex: '0 0 auto',
              padding: '0 8px',
              height: '18px',
              borderRadius: 'var(--dsw-radius-sm, 4px)',
              border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1))',
              background: 'transparent',
              color: 'inherit',
              font: 'inherit',
              cursor: state === 'saving' ? 'default' : 'pointer',
              opacity: state === 'saving' ? 0.6 : 1,
            }}
          >
            {state === 'saving' ? t('saving') : t('save')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
