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
/** Registration metadata the plugin declared. */
const definitions = [];
/** Keyed slot components by implementation id. */
const components = new Map();

let versionSeq = 0;
let revision = 0;
let root;
let mounted;

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
    file.text = payload.content;
    file.version = `v${++versionSeq}`;
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
  const match = /\/api\/dsh-sidebar-milkdown\/([a-z]+)$/.exec(url);
  if (match === null) return realFetch(input, init);
  let payload;
  try {
    payload = init?.body === undefined ? undefined : JSON.parse(init.body);
  } catch {
    payload = undefined;
  }
  const result = await fakeCall(match[1], payload);
  return { ok: true, json: async () => result };
};

/**
 * Render the body the plugin registered.
 * @param address - the address to open.
 */
function renderBody(address) {
  const component = components.get('dsh-sidebar-milkdown');
  if (component === undefined) throw new Error('the plugin registered no body');
  root.render(createElement(component, propsFor(address)));
}

/** The fake client context. */
const ctx = {
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
    register({ key }, component) {
      components.set(key, component);
      return () => components.delete(key);
    },
  },
  documentPreviews: {
    register(definition) {
      definitions.push(definition);
      return () => {};
    },
    candidates() {
      return [...definitions];
    },
  },
};

/** Put one file into the fake filesystem and mount it. */
function open(address, text, options = {}) {
  files.set(address, { name: options.name ?? 'doc.md', text, version: `v${++versionSeq}`, writable: options.writable !== false });
  revision = 0;
  renderBody(address);
}

apply(ctx);

const host = document.getElementById('host');
root = createRoot(host);

window.__test = {
  open,
  saved,
  definitions,
  loadedTokens,
  failed,
  files,
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
