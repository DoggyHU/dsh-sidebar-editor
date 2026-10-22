/**
 * Browser half of dsh-sidebar-milkdown.
 *
 * It contributes **two views** through **three renderer entries** to the shipped
 * document preview: an editable Markdown document (Milkdown) and an editable code
 * surface (CodeMirror), where the code surface needs a second entry because one
 * definition carries one priority band. The tab, header, Reload control and wrap
 * toggle all stay the official ones.
 *
 * Registration band and order are the whole trick. The registry ranks
 *
 *   `priority === 'builtin' ? 0 : 1`, descending, then matched suffix length
 *   descending, then registration order ascending
 *
 * so:
 *
 *  - the rich text view and the code view both use `'preferred'`, which outranks
 *    every shipped renderer. For a source file that makes the code surface the
 *    default view (the shipped "Code" renderer is read-only, so being second in
 *    that dropdown was its only use);
 *  - for Markdown the two of ours tie on band and suffix length, so registration
 *    order decides: the rich text view is registered first and stays the default,
 *    with the code surface and then the shipped Markdown render one dropdown entry
 *    away. A broken build is therefore always recoverable without touching the
 *    profile;
 *  - the few suffixes the product renders itself (`.html`, `.svg`, `.csv`) are
 *    claimed by a *separate* entry in the shipped `'builtin'` band, so the rendered
 *    view keeps its default there and the editor is still one dropdown entry away;
 *  - `reportToHost` re-reads every ranking through the registry's own
 *    `candidates()` and logs it, so "which view opens by default" is verifiable
 *    from the host log instead of by eye.
 *
 * Content loading is `renderer`, the same mode the shipped Office viewer uses: the
 * owner mounts the body before any bytes are read and hands it a revision plus
 * `loaded`/`failed`/`reload`. Both bodies read and write through this plugin's own
 * host routes under `/api`, so the freshness token guarding a save is the one the
 * open returned — and switching between the two views can never read stale bytes,
 * because the host half serialises those calls per path.
 */
import { createElement } from 'react';
import { BodyBoundary } from './BodyBoundary.jsx';
import { MilkdownBody } from './MilkdownBody.jsx';
import { SourceBody } from './codemirror/SourceBody.jsx';
import { PRODUCT_RENDERED_EXTENSIONS, SOURCE_EXTENSIONS } from './codemirror/claims.js';
import { ROUTE_PREFIX, endpointUrl } from './channel.js';
import { ensureStyles } from './theme.js';

/** Implementation identity: the registry id and the keyed slot key. */
export const IMPL_ID = 'dsh-sidebar-milkdown';

/** The code surface's implementation id, a second entry with its own body. */
export const CODE_IMPL_ID = 'dsh-sidebar-milkdown-code';

/**
 * The code surface's second entry, for the few suffixes the product renders itself
 * (`.html`, `.svg`, `.csv` …): same body, shipped band, so the rendered view stays
 * the default and the editor is one dropdown entry away. One definition has one
 * band, which is why this cannot be a suffix inside `CODE_IMPL_ID`.
 */
export const CODE_SHIPPED_IMPL_ID = 'dsh-sidebar-milkdown-code-shipped';

/** Suffixes the rich text view claims. HTML is left to the shipped renderer. */
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
    codeTitle: '源代码',
    linesUnit: '行',
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
    sandboxDenied: '沙箱策略拒绝写入该文件。',
    sandboxBlocked: '沙箱策略为只读，保存会被拒绝。',
    transport: '与主进程通信失败。',
  },
  en: {
    title: 'Rich editor',
    codeTitle: 'Source',
    linesUnit: 'lines',
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
    sandboxDenied: 'The sandbox policy refused to write this file.',
    sandboxBlocked: 'The sandbox policy is read-only; saving will be refused.',
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
  /** Every probe the ranking decision depends on, so the log answers "what opens by default". */
  const PROBES = ['probe.md', 'probe.py', 'probe.html', 'probe.svg', 'probe.csv', 'probe.unknownext'];
  const ranking = {};
  for (const probe of PROBES) {
    try {
      ranking[probe] = ctx.documentPreviews.candidates(probe).map((definition) => definition.id);
    } catch (error) {
      ranking[probe] = [String(error)];
    }
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

  // Both registrations live in ONE effect, and the rich text one is registered
  // first. Markdown has two entries of ours in the same band with the same suffix
  // length, so registration order is what makes the rich text view the default;
  // splitting these into two effects would let the bundler's module order decide a
  // user-visible behaviour.
  ctx.effect(
    () => {
      const disposeRich = ctx.documentPreviews.register({
        id: IMPL_ID,
        extensions: EXTENSIONS,
        // Above `builtin`: this is the Markdown view, not an extra entry beside it.
        priority: 'preferred',
        title: () => t('title'),
        // The body owns reading and writing, so it also owns the freshness token.
        loading: 'renderer',
        // Follow the official wrap toggle instead of dropping the control.
        wrap: true,
      });
      const disposeCode = ctx.documentPreviews.register({
        id: CODE_IMPL_ID,
        extensions: SOURCE_EXTENSIONS,
        // Also above `builtin`, which is what makes the editable surface the
        // default for source files instead of the shipped read-only code renderer.
        priority: 'preferred',
        title: () => t('codeTitle'),
        loading: 'renderer',
        wrap: true,
      });
      // The few suffixes the product renders better than a text editor can keep their
      // rendered default: same shipped band as the product, so it wins on registration
      // order and this entry simply appears beside it in the dropdown.
      const disposeCodeShipped = ctx.documentPreviews.register({
        id: CODE_SHIPPED_IMPL_ID,
        extensions: PRODUCT_RENDERED_EXTENSIONS,
        priority: 'builtin',
        title: () => t('codeTitle'),
        loading: 'renderer',
        wrap: true,
      });
      return () => {
        disposeCodeShipped?.();
        disposeCode?.();
        disposeRich?.();
      };
    },
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

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.tab.document', () =>
        ctx.slots.register(
          { name: 'sidebar.right.tab.document', key: CODE_IMPL_ID, locale: NS },
          (props) => createElement(BodyBoundary, { t: props.t }, createElement(SourceBody, { ...props, call: callHost })),
        ),
      ),
    'dsh-sidebar-milkdown: code renderer body',
  );

  // The same body again, under the shipped-band entry's key: the slot is keyed by
  // implementation id, so one component can serve two registrations.
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.tab.document', () =>
        ctx.slots.register(
          { name: 'sidebar.right.tab.document', key: CODE_SHIPPED_IMPL_ID, locale: NS },
          (props) => createElement(BodyBoundary, { t: props.t }, createElement(SourceBody, { ...props, call: callHost })),
        ),
      ),
    'dsh-sidebar-milkdown: code renderer body (shipped band)',
  );

  void Promise.resolve().then(() => reportToHost(ctx));
}
