/**
 * Browser half of dsh-sidebar-milkdown.
 *
 * It contributes exactly one thing to the shipped document preview: a renderer in
 * the viewer dropdown that is an *editable* Markdown document rather than a code
 * surface or a read-only render. The tab, header, Reload control and wrap toggle
 * all stay the official ones.
 *
 * Registration band is the whole trick this time. The registry ranks
 *
 *   `priority === 'builtin' ? 0 : 1`, descending, then matched suffix length
 *   descending, then registration order ascending
 *
 * so a `'preferred'` registration outranks every shipped renderer and becomes the
 * default view for `.md` — which is what "make this the Markdown view" means. The
 * shipped renderers remain one dropdown entry away, so a broken build is always
 * recoverable without touching the profile.
 *
 * Content loading is `renderer`, the same mode the shipped Office viewer uses: the
 * owner mounts the body before any bytes are read and hands it a revision plus
 * `loaded`/`failed`/`reload`. The body reads and writes through this plugin's own
 * host routes under `/api`, so the freshness token guarding a save is the one the
 * open returned.
 */
import { createElement } from 'react';
import { BodyBoundary } from './BodyBoundary.jsx';
import { MilkdownBody } from './MilkdownBody.jsx';
import { ROUTE_PREFIX, endpointUrl } from './channel.js';
import { ensureStyles } from './theme.js';

/** Implementation identity: the registry id and the keyed slot key. */
export const IMPL_ID = 'dsh-sidebar-milkdown';

/** Suffixes this view claims. HTML is left to the shipped renderer on purpose. */
export const EXTENSIONS = ['md', 'markdown'];

/** Locale namespace this plugin owns. */
export const NS = 'dshSidebarMilkdown';

export { ROUTE_PREFIX };

/**
 * Services this half cannot work without. No carrier service is needed: the host
 * routes are reached with a same-origin fetch, so a page without one shows a
 * transport failure instead of a parked plugin.
 */
export const inject = ['slots', 'locale', 'documentPreviews'];

/** Copy for both shipped languages; the two key sets must stay identical. */
const DICTIONARIES = {
  zh: {
    title: '富文本编辑器',
    loading: '读取中…',
    saving: '保存中…',
    saved: '已保存',
    unsaved: '未保存',
    saveFailed: '保存失败',
    conflictShort: '磁盘已变更',
    readonly: '只读',
    readonlyOutside: '只读（工作区外）',
    save: '保存',
    saveHint: 'Ctrl/Cmd+S',
    retry: '重试',
    overwrite: '覆盖磁盘',
    reload: '重新加载',
    conflict: '磁盘上的文件已变更，保存被拒。',
    external: '磁盘上的文件已被外部修改（你的修改还没保存）。',
    loadDisk: '载入磁盘版本',
    keepMine: '保留我的修改',
    addRow: '＋ 行',
    addColumn: '＋ 列',
    addRowHint: '在当前行之后加一行；在单元格里按 Tab 到末尾也会自动加',
    addColumnHint: '在当前列右侧加一列',
    error: '打开失败',
    switchBack: '可在工具栏下拉里切回官方预览。',
    mountFailed: '编辑器挂载失败',
    bodyCrashed: '编辑器出错（已记录日志）',
    tooLarge: '文件超过编辑器上限（2 MB）。',
    outsideWorkspace: '该文件不在会话工作区内。',
    unknownSession: '找不到对应会话，无法读写。',
    notText: '不是文本文件。',
    notFound: '文件不存在。',
    unavailable: '文件服务不可用。',
    unsupportedAddress: '文件地址无法解析。',
    transport: '与主进程通信失败。',
  },
  en: {
    title: 'Rich editor',
    loading: 'Loading…',
    saving: 'Saving…',
    saved: 'Saved',
    unsaved: 'Unsaved',
    saveFailed: 'Save failed',
    conflictShort: 'Changed on disk',
    readonly: 'Read-only',
    readonlyOutside: 'Read-only (outside workspace)',
    save: 'Save',
    saveHint: 'Ctrl/Cmd+S',
    retry: 'Retry',
    overwrite: 'Overwrite',
    reload: 'Reload',
    conflict: 'The file changed on disk; the save was refused.',
    external: 'The file was changed outside this editor (your edits are unsaved).',
    loadDisk: 'Load disk version',
    keepMine: 'Keep my edits',
    addRow: '+ Row',
    addColumn: '+ Column',
    addRowHint: 'Add a row after this one; Tab at the last cell also adds one',
    addColumnHint: 'Add a column to the right',
    error: 'Could not open',
    switchBack: 'Switch back to the official preview from the toolbar dropdown.',
    mountFailed: 'The editor failed to mount',
    bodyCrashed: 'The editor crashed (logged)',
    tooLarge: 'The file is larger than this editor allows (2 MB).',
    outsideWorkspace: 'The file is outside the session workspace.',
    unknownSession: 'The owning session was not found.',
    notText: 'Not a text file.',
    notFound: 'The file does not exist.',
    unavailable: 'The filesystem service is unavailable.',
    unsupportedAddress: 'The file address could not be parsed.',
    transport: 'Talking to the host failed.',
  },
};

/**
 * One call to the host half.
 *
 * A plain same-origin POST: the `/api` prefix route that owns these paths runs
 * Connection's Host/Origin fence and browser-cookie admission before dispatching
 * to us, so this is authenticated the same way the rest of the UI is.
 * @param endpoint - `ping` | `probe` | `open` | `save` | `report` | `diag`.
 * @param payload - the endpoint's JSON payload.
 * @param signal - the tab's abort signal.
 * @returns the host half's JSON result; throws on a transport-level failure.
 */
export async function callHost(endpoint, payload, signal) {
  const response = await fetch(endpointUrl(endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    credentials: 'same-origin',
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  return await response.json();
}

/**
 * What the page resolves the editor's font to.
 *
 * A font that ends up serif is the hardest kind of report to act on from the outside:
 * the CSS says the right token, the token says the right family, and the glyphs are
 * still 宋体 because Chromium fell back to its *standard* font for Chinese. Recording
 * the resolved stack and the token values lets that be read from the host log instead
 * of guessed at.
 * @returns a JSON-safe font report, or `undefined` when it cannot be measured.
 */
function fontDiagnostics() {
  try {
    const doc = globalThis.document;
    if (doc === undefined || doc.body === null) return undefined;
    const live = doc.querySelector('.dsh-mk-surface');
    let host = live;
    let probe;
    if (host === null) {
      const root = doc.createElement('div');
      root.className = 'dsh-mk-root';
      probe = doc.createElement('div');
      probe.className = 'dsh-mk-surface';
      probe.textContent = '字体 Test 123';
      root.style.position = 'absolute';
      root.style.visibility = 'hidden';
      root.append(probe);
      doc.body.append(root);
      host = probe;
    }
    const computed = getComputedStyle(host);
    const bodyStyle = getComputedStyle(doc.body);
    const report = {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      bodyFontFamily: bodyStyle.fontFamily,
      tokens: {
        fontFamily: bodyStyle.getPropertyValue('--dsw-font-family').trim(),
        markdownBaseFamily: bodyStyle.getPropertyValue('--dsw-font-markdown-base-font-family').trim(),
        markdownBaseSize: bodyStyle.getPropertyValue('--dsw-font-markdown-base-font-size').trim(),
        markdownH1Size: bodyStyle.getPropertyValue('--dsw-font-markdown-h1-font-size').trim(),
        codeFamily: bodyStyle.getPropertyValue('--ds-font-family-code').trim(),
      },
    };
    probe?.parentElement?.remove();
    return report;
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

/**
 * Report this half's registration facts to the host log.
 *
 * Diagnostic only, and every step is guarded: a plugin must never fail its own
 * registration over telemetry. The ranking is included because "which entry is the
 * default view" is decided by ranking and nothing else; the font block because a
 * wrong-looking document is otherwise unattributable.
 * @param ctx - client plugin context.
 */
async function reportToHost(ctx) {
  let ranking;
  try {
    ranking = ctx.documentPreviews.candidates('probe.md').map((definition) => definition.id);
  } catch (error) {
    ranking = [String(error)];
  }
  try {
    await callHost('report', {
      implementation: IMPL_ID,
      ranking,
      font: fontDiagnostics(),
      reportedAt: new Date().toISOString(),
    });
  } catch {
    /* the host half may not be mounted yet; the report is not load-bearing */
  }
}

/**
 * Client plugin body: stylesheet, copy, renderer metadata, and its body.
 * @param ctx - client context carrying slots, copy, and the preview registry.
 */
export function apply(ctx) {
  try {
    ensureStyles(globalThis.document);
  } catch {
    /* a page without a document cannot show an editor anyway */
  }

  ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'dsh-sidebar-milkdown: dictionaries');
  const t = ctx.locale.bind(NS);

  ctx.effect(
    () =>
      ctx.documentPreviews.register({
        id: IMPL_ID,
        extensions: EXTENSIONS,
        // Above `builtin`: this is the Markdown view, not an extra entry beside it.
        priority: 'preferred',
        title: () => t('title'),
        // The body owns reading and writing, so it also owns the freshness token.
        loading: 'renderer',
        // Follow the official wrap toggle instead of dropping the control.
        wrap: true,
      }),
    'dsh-sidebar-milkdown: renderer metadata',
  );

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.tab.document', () =>
        ctx.slots.register(
          { name: 'sidebar.right.tab.document', key: IMPL_ID, locale: NS },
          // The body gets props, not the plugin context, so the host caller is
          // bound in through a closure.
          (props) => createElement(BodyBoundary, { t: props.t }, createElement(MilkdownBody, { ...props, call: callHost })),
        ),
      ),
    'dsh-sidebar-milkdown: renderer body',
  );

  void Promise.resolve().then(() => reportToHost(ctx));
}
