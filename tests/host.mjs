/**
 * Host-half test: mount `apply()` against a fake context and drive its routes.
 *
 * This is the half the browser tests deliberately do not touch — they intercept
 * `fetch` and answer from a fake file table. So without this file, a broken route
 * registration or a bug in the read/write path would first show up as
 * "打开失败：与主进程通信失败" on the user's screen, with a restart as the only
 * way to test a fix.
 *
 * The fake context mirrors what the tested old plugin's host half needed:
 * `connection.fetch.register`, `fs`, `sessions`, `sandboxPolicy`, and cordis's
 * `effect`/`inject`. Nothing here re-implements the real services' behaviour —
 * only the shapes this plugin reads.
 */
import { parseSessionFileAddress } from '../src/index.js';
import { apply } from '../src/index.js';

const failures = [];
function check(name, condition, detail) {
  if (condition === true) {
    console.log(`  ok   ${name}`);
    return;
  }
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(name);
}

const SESSION = 'session-1';
const ROOT = 'D:/workspace';

/** One file the fake filesystem can read and write. */
const files = new Map([
  ['D:/workspace/note.md', { text: '# 标题\n\n正文\n', version: 'v1' }],
  ['D:/elsewhere/outside.md', { text: 'outside\n', version: 'v1' }],
]);

/**
 * Collapse `.` and `..` the way a real backend does before touching the disk.
 * @param path - a slash-separated path.
 * @returns the normalised path.
 */
function normalizePath(path) {
  const out = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      if (out.length === 0) out.push('');
      continue;
    }
    if (segment === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/** Resolve a path string the way the local backend would, relative to a cwd. */
function resolvePath(path, cwd) {
  const normalized = path.replaceAll('\\', '/');
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) return { key: normalizePath(normalized), root: false };
  return { key: normalizePath(`${(cwd ?? ROOT).replace(/\/$/, '')}/${normalized}`), root: false };
}

const fs = {
  async resolve(path, options) {
    return resolvePath(path, options?.cwd);
  },
  processPath(target) {
    return target.key;
  },
  contains(rootTarget, target) {
    return target.key.replaceAll('\\', '/').startsWith(`${rootTarget.key.replaceAll('\\', '/')}/`);
  },
  async stat(target) {
    const file = files.get(target.key);
    return file === undefined ? undefined : { type: 'file', size: file.text.length, version: file.version };
  },
  async readText(target) {
    const file = files.get(target.key);
    if (file === undefined) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' });
    return file.text;
  },
  async writeText(target, text, expected, _signal, policy) {
    const file = files.get(target.key);
    if (file === undefined) throw Object.assign(new Error('missing'), { code: 'FS_NOT_FOUND' });
    if (policy === undefined) throw Object.assign(new Error('no policy'), { code: 'FS_SANDBOX_DENIED' });
    if (expected?.kind === 'replaceIfVersion' && expected.version !== file.version) {
      throw Object.assign(new Error('stale'), { code: 'FS_STALE_VERSION' });
    }
    file.text = text;
    file.version = `v${Number(file.version.slice(1)) + 1}`;
    return { version: file.version, operation: expected === undefined ? 'replace' : 'replaceIfVersion' };
  },
  async readByteRange() {
    return new Uint8Array([0x23]);
  },
};

const sessions = {
  get(id) {
    return id === SESSION ? { header: { cwd: ROOT } } : undefined;
  },
};

/**
 * The session's sandbox mode, switchable per case: the write boundary is the
 * session's policy, so the tests have to be able to move it.
 */
let policyMode = 'workspace-write';

const sandboxPolicy = {
  resolve() {
    return { mode: policyMode, workspaceRoot: ROOT };
  },
};

/** Routes the plugin registered, by path. */
const routes = new Map();

const ctx = {
  get(name) {
    if (name === 'fs') return fs;
    if (name === 'sessions') return sessions;
    if (name === 'sandboxPolicy') return sandboxPolicy;
    if (name === 'connection') return connection;
    return undefined;
  },
  effect(fn) {
    const disposer = fn();
    return typeof disposer === 'function' ? disposer : () => {};
  },
  inject(names, callback) {
    callback(ctx);
  },
};

const connection = {
  fetch: {
    register({ path, methods, fetch: handler }) {
      routes.set(path, { methods, handler });
      return () => routes.delete(path);
    },
  },
};

// Cordis hands `ctx.inject(['connection'], cb)` a context whose services are
// properties (`ctx.connection`), while this plugin reads them through `ctx.get`.
// The fake needs both spellings or the host half stays dark with no error.
Object.assign(ctx, { connection, fs, sessions, sandboxPolicy });

apply(ctx);

// ── 1. it mounted ───────────────────────────────────────────────────────────
console.log('mount');
const expectedRoutes = ['ping', 'probe', 'open', 'save', 'report', 'diag'].map(
  (endpoint) => `/api/dsh-sidebar-editor/${endpoint}`,
);
check('registered every route', expectedRoutes.every((path) => routes.has(path)), [...routes.keys()].join(', '));
check('no route outside the plugin prefix', [...routes.keys()].every((path) => path.startsWith('/api/dsh-sidebar-editor/')));

/**
 * Call one route the way the webserver would.
 * @param endpoint - route name.
 * @param payload - JSON body.
 * @returns the decoded response body.
 */
async function call(endpoint, payload) {
  const route = routes.get(`/api/dsh-sidebar-editor/${endpoint}`);
  if (route === undefined) throw new Error(`no route for ${endpoint}`);
  const request = new Request(`http://localhost/api/dsh-sidebar-editor/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
    headers: { 'content-type': 'application/json' },
  });
  const response = await route.handler(request);
  return await response.json();
}

// ── 2. ping / probe ─────────────────────────────────────────────────────────
console.log('diagnostics');
const ping = await call('ping', {});
check('ping answers the plugin name', ping.ok === true && ping.plugin === 'dsh-sidebar-editor', JSON.stringify(ping));
const probe = await call('probe', {});
check('probe reports the filesystem', probe.services?.fs?.present === true, JSON.stringify(probe).slice(0, 200));
check('probe reports the sandbox policy', probe.services?.sandboxPolicy?.present === true);

// ── 3. address parsing ──────────────────────────────────────────────────────
console.log('addresses');
const parsed = parseSessionFileAddress(`dsh-resource://file/session/${SESSION}/sub/note%20one.md`);
check('session addresses carry the session and the decoded path', parsed?.sessionId === SESSION && parsed.path === 'sub/note one.md', JSON.stringify(parsed));
check('absolute addresses are refused', parseSessionFileAddress('dsh-resource://file/absolute/D:/x.md') === undefined);

// ── 4. open ─────────────────────────────────────────────────────────────────
console.log('open');
const address = `dsh-resource://file/session/${SESSION}/note.md`;
const opened = await call('open', { address });
check('open returns the text', opened.ok === true && opened.text === '# 标题\n\n正文\n', JSON.stringify(opened).slice(0, 160));
check('open returns a freshness token', typeof opened.version === 'string', opened.version);
check('open reports the line ending', opened.eol === 'lf');
check('open reports a byte-order mark flag', opened.bom === false);
check('open marks a workspace file writable', opened.writable === true);
check('open forwards the sandbox mode', opened.sandbox?.mode === 'workspace-write', JSON.stringify(opened.sandbox));
const missing = await call('open', { address: `dsh-resource://file/session/${SESSION}/nope.md` });
check('missing file answers not-found', missing.ok === false && missing.code === 'not-found', JSON.stringify(missing));
const bogus = await call('open', { address: 'not-an-address' });
check('a non-file address is refused', bogus.ok === false && bogus.code === 'unsupported-address', JSON.stringify(bogus));

// ── 5. save ─────────────────────────────────────────────────────────────────
console.log('save');
const saved = await call('save', { address, content: '# 标题\n\n改过的正文\n', baseVersion: opened.version, eol: 'lf', bom: false });
check('save writes', saved.ok === true, JSON.stringify(saved));
check('save returns the new token', typeof saved.version === 'string' && saved.version !== opened.version, saved.version);
check('the file holds the new text', files.get('D:/workspace/note.md').text === '# 标题\n\n改过的正文\n');
const stale = await call('save', { address, content: 'stale\n', baseVersion: opened.version, eol: 'lf', bom: false });
check('a stale base version is a conflict', stale.ok === false && stale.code === 'conflict', JSON.stringify(stale));
check('the conflict carries the current bytes', stale.current?.text === '# 标题\n\n改过的正文\n', JSON.stringify(stale.current));
const forced = await call('save', { address, content: 'forced\n', eol: 'lf', bom: false });
check('no base version overwrites', forced.ok === true && files.get('D:/workspace/note.md').text === 'forced\n', JSON.stringify(forced));

// Outside the workspace: readable, not writable. The plugin answers `open` read-only
// and refuses the write, which is what the body turns into a read-only editor.
const outsideAddress = `dsh-resource://file/session/${SESSION}/../elsewhere/outside.md`;
const outsideOpen = await call('open', { address: outsideAddress });
check('a file outside the workspace opens read-only', outsideOpen.ok === true && outsideOpen.writable === false, JSON.stringify(outsideOpen).slice(0, 160));
const outsideSave = await call('save', { address: outsideAddress, content: 'nope\n', eol: 'lf', bom: false });
check('a write outside the workspace is refused', outsideSave.ok === false && outsideSave.code === 'outside-workspace', JSON.stringify(outsideSave));

// The same file under a `danger-full-access` session: the platform allows the write,
// so the editor must not keep pretending the file is read-only. This is the case a
// user hit when a report sat in a folder outside the conversation's workspace.
policyMode = 'danger-full-access';
const outsideUnrestricted = await call('open', { address: outsideAddress });
check(
  'an unrestricted session opens an outside file writable',
  outsideUnrestricted.ok === true && outsideUnrestricted.writable === true,
  JSON.stringify(outsideUnrestricted).slice(0, 200),
);
check('the sandbox block reports the unrestricted mode', outsideUnrestricted.sandbox?.mode === 'danger-full-access', JSON.stringify(outsideUnrestricted.sandbox));
const outsideWrite = await call('save', {
  address: outsideAddress,
  content: 'edited outside\n',
  baseVersion: outsideUnrestricted.version,
  eol: 'lf',
  bom: false,
});
check(
  'the outside write lands while the session is unrestricted',
  outsideWrite.ok === true && files.get('D:/elsewhere/outside.md').text === 'edited outside\n',
  JSON.stringify(outsideWrite),
);
policyMode = 'workspace-write';
const outsideAgain = await call('save', { address: outsideAddress, content: 'nope\n', eol: 'lf', bom: false });
check('the same write is refused again under workspace-write', outsideAgain.ok === false && outsideAgain.code === 'outside-workspace', JSON.stringify(outsideAgain));

// A byte-order mark and CRLF must survive a save that never touched them.
files.set('D:/workspace/crlf.md', { text: '\uFEFF第一行\r\n第二行\r\n', version: 'v1' });
const crlfAddress = `dsh-resource://file/session/${SESSION}/crlf.md`;
const crlfOpen = await call('open', { address: crlfAddress });
check('a CRLF file is normalised for editing', crlfOpen.text === '第一行\n第二行\n', JSON.stringify(crlfOpen.text));
check('the line ending is remembered', crlfOpen.eol === 'crlf');
check('the byte-order mark is remembered', crlfOpen.bom === true);
await call('save', { address: crlfAddress, content: `第一行\n第二行\n第三行\n`, baseVersion: crlfOpen.version, eol: crlfOpen.eol, bom: crlfOpen.bom });
check(
  'saving restores CRLF and the byte-order mark',
  files.get('D:/workspace/crlf.md').text === '\uFEFF第一行\r\n第二行\r\n第三行\r\n',
  JSON.stringify(files.get('D:/workspace/crlf.md').text),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log('\nhost checks passed');
