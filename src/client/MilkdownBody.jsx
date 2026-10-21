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
 *  4. auto-save shortly after typing stops, save immediately on blur and on
 *     Ctrl/Cmd+S, and flush a pending edit before the view is torn down;
 *  5. answer a `conflict` (the file changed on disk) by *stopping* auto-save and
 *     offering overwrite or reload, never by silently clobbering.
 *
 * The owner contract is the shipped `loading: 'renderer'` one: the body is mounted
 * before any bytes are read and is handed `{ revision, loaded, failed, reload }`,
 * with `revision` as the only reload trigger.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { joinFrontmatter, mountMilkdown, readMarkdown, splitFrontmatter } from './editor.js';

/** Quiet period after the last edit before the file is written. */
const AUTO_SAVE_MS = 900;

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
  const mountRef = useRef(null);
  const editorRef = useRef(undefined);
  const docRef = useRef({ phase: 'loading' });
  /** Latest serialized body Markdown. */
  const markdownRef = useRef(undefined);
  /** Body Markdown last known to be on disk; the save baseline. */
  const baselineRef = useRef(undefined);
  /** Preserved frontmatter block, re-attached on save. */
  const frontRef = useRef('');
  const timerRef = useRef(null);
  /** True while the disk version is unknown (after a conflict or a failed save). */
  const pausedRef = useRef(false);
  const saveRef = useRef(undefined);

  const [doc, setDoc] = useState({ phase: 'loading' });
  const [state, setState] = useState('idle');
  const [notice, setNotice] = useState(undefined);

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
      const body = markdownRef.current ?? readMarkdown(editor);
      if (force !== true && body === baselineRef.current) return;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
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

  /**
   * Adopt one serialized document as the buffer, and re-arm the auto-save timer.
   * @param markdown - the editor's serialized Markdown.
   */
  const handleChange = useCallback((markdown) => {
    markdownRef.current = markdown;
    if (docRef.current.phase !== 'ready') return;
    if (markdown === baselineRef.current) {
      setState('saved');
      return;
    }
    setState('dirty');
    // While the disk version is unknown, typing must not queue another write: the
    // next one would either fail or clobber a file someone else changed.
    if (pausedRef.current) return;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveRef.current?.(false);
    }, AUTO_SAVE_MS);
  }, []);

  // Read the file (and re-read it whenever the owner's revision changes), then
  // mount the editor. The cleanup persists a pending edit and destroys the view.
  useEffect(() => {
    if (address === '' || typeof call !== 'function') return undefined;
    const controller = new AbortController();
    let cancelled = false;
    pausedRef.current = false;
    setState('idle');
    setNotice(undefined);
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
      const parts = splitFrontmatter(result.text);
      frontRef.current = parts.front;
      const next = {
        phase: 'ready',
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
        // The baseline is what the serializer produces for the document as loaded,
        // not the file's own bytes: see the header.
        const initial = readMarkdown(editor);
        markdownRef.current = initial;
        baselineRef.current = initial;
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
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const held = docRef.current;
      const pending = markdownRef.current !== undefined && markdownRef.current !== baselineRef.current;
      if (held.phase === 'ready' && held.writable === true && pending) void saveRef.current?.(false);
      const editor = editorRef.current;
      editorRef.current = undefined;
      markdownRef.current = undefined;
      baselineRef.current = undefined;
      if (editor !== undefined) void editor.destroy();
    };
    // `doc` is read through `docRef` on purpose: re-running on every edit would
    // re-open the file. The owner's revision is the only reload trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, address]);

  // Ctrl/Cmd+S saves through the version guard (not an overwrite): a conflict here
  // should surface, not be forced.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return undefined;
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        void saveRef.current?.(false);
      }
    };
    host.addEventListener('keydown', onKeyDown, true);
    return () => host.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const wrapOn = wrap !== false;
  const stateText =
    doc.phase === 'loading'
      ? label('loading', '读取中…')
      : state === 'saving'
        ? label('saving', '保存中…')
        : state === 'dirty'
          ? label('unsaved', '未保存')
          : state === 'error'
            ? label('saveFailed', '保存失败')
            : state === 'conflict'
              ? label('conflictShort', '磁盘已变更')
              : state === 'saved'
                ? label('saved', '已保存')
                : label('readonly', '只读');

  const retry = () => {
    if (typeof content?.reload === 'function') content.reload();
  };

  return (
    <div ref={hostRef} className={`dsh-mk-root${wrapOn ? '' : ' dsh-mk-nowrap'}`}>
      {notice === undefined ? null : (
        <div className="dsh-mk-notice" data-kind={notice.kind}>
          <span className="dsh-mk-notice-text">
            {notice.kind === 'conflict'
              ? label('conflict', '磁盘上的文件已变更，保存被拒。')
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
          ) : (
            <button className="dsh-mk-button" type="button" onClick={() => void saveRef.current?.(false)}>
              {label('retry', '重试')}
            </button>
          )}
        </div>
      )}

      <div className="dsh-mk-scroll">
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
