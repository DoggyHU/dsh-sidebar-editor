/**
 * The browser harness page: mount the plugin's registered body over fake files.
 *
 * This imports `src/client/index.js` directly rather than the built bundle, so a
 * failure is a source failure and the stack points at a file. Everything the real
 * page supplies through cordis is faked here — nothing else:
 *
 *  - `slots` records the keyed component the plugin registers;
 *  - `locale` binds the plugin's own dictionary;
 *  - `documentPreviews` records the renderer metadata (the ranking test reads it);
 *  - `call` stands in for the host channel and records every `save` payload.
 *
 * The fake file map is exposed on `window.__test` so assertions run from the test
 * process, not from inside this file.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { apply } from '../../src/client/index.js';

// Ask the editor for a test handle (see `mountMilkdown`); the harness reads it to
// distinguish a DOM selection from the document selection.
globalThis.__DSH_MILKDOWN_DEBUG__ = true;

/** One fake file per address: text, plus the freshness token a save is checked against. */
const files = new Map();
/** Every save payload the body sent, in order. */
const saved = [];
/** Payloads the client half reported to the host (`report` endpoint). */
const reports = [];
/** Registration metadata the plugin declared. */
const definitions = [];
/** Keyed slot components by implementation id. */
const components = new Map();

let versionSeq = 0;
let revision = 0;
let root;
let mounted;
/** The Session the fake right Sidebar says is on screen. */
const currentSessionId = 'session-test';
/** The list-slot host currently mounted (the dock tab menu rows). */
let listRoot;
let listHost;
/** The address currently rendered, so a revision bump can re-render it. */
let currentAddress;
/** Which renderer is currently mounted: the rich text view or the code surface. */
let currentImpl = 'dsh-sidebar-editor';
/**
 * Simulate an owner that reloads the tab when the file changes on disk.
 *
 * The real preview bumped its revision after a save in the field report (that is
 * what made the editor remount mid-typing), so the harness has to be able to
 * reproduce it: flip this on and every save answers with a new revision.
 */
let ownerReloadsOnSave = false;
/**
 * Make the next save answer `conflict` while the file holds `text`.
 *
 * Two field reports need this: a write that *did* land but came back as a stale-token
 * conflict (queued save points, or the owner's reload raising the version first), and a
 * genuine conflict where the disk really has other bytes.
 * @type {{ text: string } | undefined}
 */
let armedConflict;

/** The props the real owner would pass to the keyed document slot. */
function propsFor(address) {
  const bound = localeBinder;
  return {
    t: bound,
    resourceAddress: address,
    wrap: true,
    scrollportRef: { current: null },
    content: {
      kind: 'renderer',
      revision,
      loaded(version) {
        loadedTokens.push({ address, version });
      },
      failed() {
        failed.push(address);
      },
      reload() {
        revision += 1;
        renderBody(address);
      },
    },
    call: fakeCall,
  };
}

const loadedTokens = [];
const failed = [];

/**
 * Stand-in for `callHost`.
 * @param endpoint - `open` | `save` | `report` | anything else.
 * @param payload - the endpoint payload.
 * @returns a JSON result shaped like the host half's.
 */
async function fakeCall(endpoint, payload) {
  if (endpoint === 'open') {
    const file = files.get(payload.address);
    if (file === undefined) return { ok: false, code: 'not-found' };
    return {
      ok: true,
      absolutePath: `D:/workspace/${file.name}`,
      path: file.name,
      version: file.version,
      bytes: file.text.length,
      writable: file.writable !== false,
      sandbox: { mode: 'danger-full-access', allowsWrite: true },
      eol: 'lf',
      bom: false,
      text: file.text,
    };
  }
  if (endpoint === 'save') {
    saved.push({ ...payload });
    const file = files.get(payload.address);
    if (file === undefined) return { ok: false, code: 'not-found' };
    if (armedConflict !== undefined) {
      // The write lands, but the answer is a conflict carrying whatever the fake disk
      // now holds: identical bytes = the "stale token, already written" case, different
      // bytes = a real external edit.
      const held = armedConflict.text;
      armedConflict = undefined;
      file.text = held;
      file.version = `v${++versionSeq}`;
      return { ok: false, code: 'conflict', current: { text: file.text, version: file.version, eol: 'lf', bom: false } };
    }
    file.text = payload.content;
    file.version = `v${++versionSeq}`;
    if (ownerReloadsOnSave === true) {
      // The owner noticing the write and reloading the tab. React reconciles the same
      // component element, so this reproduces the field report exactly: a revision
      // arrives while the user is still typing.
      revision += 1;
      renderBody(currentAddress, currentImpl);
    }
    return { ok: true, version: file.version, bytes: payload.content.length };
  }
  return { ok: true };
}

let localeBinder = (key) => key;

/**
 * Answer this plugin's own routes out of the fake file map.
 *
 * The body is registered with the plugin's real `callHost` (that is the shipping
 * wiring), so the harness intercepts at `fetch` instead of at the prop: the
 * request path, the JSON body and the result shape all stay on the real code path.
 */
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  const match = /\/api\/dsh-sidebar-editor\/([a-z]+)$/.exec(url);
  if (match === null) return realFetch(input, init);
  let payload;
  try {
    payload = init?.body === undefined ? undefined : JSON.parse(init.body);
  } catch {
    payload = undefined;
  }
  const result = await fakeCall(match[1], payload);
  if (match[1] === 'report') reports.push(payload);
  return { ok: true, json: async () => result };
};

/**
 * Render one of the bodies the plugin registered.
 * @param address - the address to open.
 * @param implId - which renderer: its `documentPreviews` id, also the slot key.
 */
function renderBody(address, implId = 'dsh-sidebar-editor') {
  const component = components.get(`sidebar.right.tab.document::${implId}`);
  if (component === undefined) throw new Error(`the plugin registered no body for ${implId}`);
  currentAddress = address;
  currentImpl = implId;
  root.render(createElement(component, propsFor(address)));
}

/**
 * Fake `ctx.sidebarRight`: what a bulk close reads and the tab ids it closes.
 *
 * The real service is the product's own; only the four members this plugin touches
 * are reproduced, with the same shapes (`mounted` and `openTabs` are snapshot stores,
 * `tabsIn` returns committed records, `close` takes one id).
 */
let tabsState = [];
const closedTabs = [];
const fakeSidebarRight = {
  mounted: { getSnapshot: () => currentSessionId },
  openTabs: {
    getSnapshot: () => tabsState.map((tab) => ({ sessionId: currentSessionId, tabId: tab.id, kind: tab.kind ?? 'document' })),
  },
  tabsIn(sessionId) {
    return sessionId === currentSessionId ? tabsState.map((tab) => ({ ...tab })) : [];
  },
  close(tabId) {
    closedTabs.push(tabId);
  },
};

/** The fake client context. */
const ctx = {
  sidebarRight: fakeSidebarRight,
  get(name) {
    if (name === 'sidebarRight') return fakeSidebarRight;
    return undefined;
  },
  effect(fn) {
    const disposer = fn();
    return typeof disposer === 'function' ? disposer : () => {};
  },
  locale: {
    register(namespace, dictionaries) {
      localeBinder = (key, params) => {
        const table = dictionaries.zh ?? dictionaries.en ?? {};
        const template = table[key] ?? key;
        if (params === undefined) return template;
        return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
      };
      return () => {};
    },
    bind() {
      return localeBinder;
    },
  },
  slots: {
    inject(_name, fn) {
      return ctx.effect(fn);
    },
    // Keyed bodies register with `key`, list items with `id`; one map keyed by both
    // the slot name and that identity keeps them apart.
    register({ name, key, id }, component) {
      const slotName = name ?? 'sidebar.right.tab.document';
      const identity = key ?? id;
      const mapKey = `${slotName}::${identity}`;
      components.set(mapKey, component);
      return () => components.delete(mapKey);
    },
  },
  documentPreviews: {
    register(definition) {
      definitions.push(definition);
      return () => {};
    },
    /**
     * The registry's own ranking, reproduced: band first (a non-`builtin` priority
     * wins), then matched suffix length, then registration order. The client half
     * reports this at startup, so the arrangement that decides the default view is
     * asserted here instead of being assumed.
     * @param path - a probe path used only for its suffix.
     * @returns the matching definitions, most preferred first.
     */
    candidates(path) {
      const name = typeof path === 'string' ? path.toLowerCase() : '';
      const suffix = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
      return definitions
        .map((definition, order) => ({
          definition,
          order,
          rank: definition.priority === 'builtin' ? 0 : 1,
          length: definition.extensions.includes(suffix) ? suffix.length : 0,
        }))
        .filter((candidate) => candidate.length > 0)
        .sort((left, right) => right.rank - left.rank || right.length - left.length || left.order - right.order)
        .map((candidate) => candidate.definition);
    },
  },
};

/** Put one file into the fake filesystem and mount it. */
function open(address, text, options = {}) {
  files.set(address, { name: options.name ?? 'doc.md', text, version: `v${++versionSeq}`, writable: options.writable !== false });
  revision = 0;
  renderBody(address, options.impl);
}

apply(ctx);

const host = document.getElementById('host');
root = createRoot(host);

window.__test = {
  open,
  saved,
  reports,
  definitions,
  loadedTokens,
  failed,
  files,
  /** Bump the owner's revision the way a real reload would. */
  bumpRevision() {
    revision += 1;
    renderBody(currentAddress, currentImpl);
  },
  /**
   * Re-render an address that is already in the fake filesystem, under another
   * renderer, without resetting its bytes — the "switch view" path.
   * @param address - the file address.
   * @param implId - which renderer to mount.
   */
  show(address, implId) {
    if (files.has(address) !== true) return false;
    renderBody(address, implId);
    return true;
  },
  /** Which renderer is mounted. */
  currentImpl() {
    return currentImpl;
  },
  /** The code surface's buffer, as the browser has it. */
  codeText() {
    return document.querySelector('.dsh-src-host .cm-content')?.textContent ?? null;
  },
  /** How many logical lines the code surface renders. */
  codeLines() {
    return document.querySelectorAll('.dsh-src-host .cm-line').length;
  },
  /** Whether the code surface's content is editable. */
  codeEditable() {
    const content = document.querySelector('.dsh-src-host .cm-content');
    return content === null ? null : content.getAttribute('contenteditable');
  },
  /**
   * Declare which tabs the fake right Sidebar has open for the on-screen Session.
   * @param tabs - `[{ id, kind? }]`.
   */
  setTabs(tabs) {
    tabsState = (Array.isArray(tabs) ? tabs : []).map((tab, index) => ({
      id: typeof tab?.id === 'string' ? tab.id : `tab-${index}`,
      kind: tab?.kind ?? 'document',
    }));
    closedTabs.length = 0;
    return tabsState.length;
  },
  /** Tab ids the plugin asked the fake service to close, in order. */
  closedTabs() {
    return [...closedTabs];
  },
  /** Whether the last menu row called the slot's `dismiss`. */
  menuDismissed() {
    return window.__dismissed === true;
  },
  /**
   * Mount one registered list-slot item (the dock tab menu rows) on its own host.
   * @param slotName - the slot the item was registered into.
   * @param id - the item's registration id.
   * @param props - the props the suite would pass (`tab`, `dismiss`).
   * @returns `true` when the plugin had registered something there.
   */
  mountListItem(slotName, id, props) {
    const component = components.get(`${slotName}::${id}`);
    if (component === undefined) return false;
    window.__dismissed = false;
    if (listHost === undefined) {
      listHost = document.createElement('div');
      document.body.append(listHost);
      listRoot = createRoot(listHost);
    }
    // The real slot runtime injects a translator for a registration that declares a
    // locale namespace, so the fake has to as well or the rows render raw keys.
    listRoot.render(createElement(component, { t: localeBinder, ...props }));
    return true;
  },
  /** Unmount the list-slot host. */
  unmountListItem() {
    if (listRoot !== undefined) {
      listRoot.unmount();
      listRoot = undefined;
    }
    if (listHost !== undefined) {
      listHost.remove();
      listHost = undefined;
    }
  },
  /** The menu rows currently rendered, as text. */
  menuRowLabels() {
    return [...document.querySelectorAll('.dsh-se-tab-menu-item')].map((node) => node.textContent);
  },
  /** Click one menu row by its label text. */
  clickMenuRow(label) {
    const row = [...document.querySelectorAll('.dsh-se-tab-menu-item')].find((node) => node.textContent === label);
    if (row === undefined) return false;
    row.click();
    return true;
  },
  /** The current owner revision, for diagnostics. */
  revisionValue() {
    return revision;
  },
  /** Whether the fake owner reloads after a save, for diagnostics. */
  ownerReloads() {
    return ownerReloadsOnSave;
  },
  /** Simulate an owner that reloads the tab whenever the file changes on disk. */
  setOwnerReloadsOnSave(value) {
    ownerReloadsOnSave = value === true;
  },
  /**
   * Arm the next save to answer `conflict` while the disk holds `text`.
   * @param text - what the fake disk will contain after that save attempt.
   */
  armConflict(text) {
    armedConflict = { text: String(text ?? '') };
  },
  /** Write the fake file behind the editor's back, then tell the owner. */
  writeSilently(address, text) {
    const file = files.get(address);
    if (file === undefined) return false;
    file.text = text;
    file.version = `v${++versionSeq}`;
    return true;
  },
  /** The live ProseMirror DOM node, for identity checks across a reload. */
  proseMirror() {
    return document.querySelector('.ProseMirror');
  },
  get mounted() {
    return mounted;
  },
  setMounted(value) {
    mounted = value;
  },
  getBodyAddress(address) {
    const file = files.get(address);
    return file === undefined ? undefined : file.text;
  },
};

// One mount so a test that only inspects registration still has a page.
open('dsh-resource://file/session/test/sample.md', window.__initialText ?? '# empty\n');
