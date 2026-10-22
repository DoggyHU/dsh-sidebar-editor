/**
 * Packaging test: does `lib/client.js` load the way the harness loads it?
 *
 * The rest of the suite imports `src/client/index.js` directly, which is what you
 * want when a test fails (the stack points at a source file). It does mean nothing
 * else would catch the wrapper being wrong — a bundle that does not call
 * `window.__ModuleLoader__.load({ id, factory })`, or whose factory does not return
 * the plugin's exports, mounts silently as nothing at all.
 *
 * So this opens a blank page, defines the loader, loads the built file as a script
 * exactly like the app does, and inspects what came out.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Every `/api/<plugin>/<endpoint>` path a file mentions.
 * @param text - a source or bundle's text.
 * @returns the distinct prefixes, sorted.
 */
function routePrefixes(text) {
  return [...new Set([...text.matchAll(/\/api\/dsh-[a-z0-9-]+/g)].map((match) => match[0]))].sort();
}

// The two halves must agree on the route prefix; a typo in one of them shows up as
// "打开失败：文件服务不可用" in the UI and nothing at all in the logs.
const hostPrefixes = routePrefixes(readFileSync(join(root, 'src', 'index.js'), 'utf8'));
const clientPrefixes = routePrefixes(readFileSync(join(root, 'lib', 'client.js'), 'utf8'));
const artifacts = join(root, '.test-artifacts');
mkdirSync(artifacts, { recursive: true });
const html = join(artifacts, 'artifact.html');
writeFileSync(
  html,
  `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
  window.__loaded = [];
  window.__ModuleLoader__ = { load(entry) { window.__loaded.push({ id: entry.id, hasFactory: typeof entry.factory }); window.__factory = entry.factory; } };
  // A React stub only needs to be Constructable and callable: this test asks what
  // the factory returns, not whether it renders (the browser suite does that).
  window.__reactStub = {
    Component: class Component { constructor(props) { this.props = props; } },
    PureComponent: class PureComponent { constructor(props) { this.props = props; } },
    createElement: () => null,
    useRef: () => ({ current: null }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    forwardRef: () => () => null,
  };
  window.__jsxStub = { jsx: () => null, jsxs: () => null, jsxDEV: () => null, Fragment: null };
</script>
<script src="../lib/client.js"></script>
</body></html>
`,
  'utf8',
);

const failures = [];
function check(name, condition, detail) {
  if (condition === true) {
    console.log(`  ok   ${name}`);
    return;
  }
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  failures.push(name);
}

const executablePath = join(
  process.env.LOCALAPPDATA ?? '',
  'ms-playwright',
  'chromium-1208',
  'chrome-win64',
  'chrome.exe',
);

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(`file:///${html.replaceAll('\\', '/')}`);
await page.waitForTimeout(500);

const state = await page.evaluate(() => ({
  loaded: window.__loaded,
  // The factory's `require` answers platform seed words; a stub is enough to see
  // whether the factory returns the plugin surface without materialising React.
  exports:
    typeof window.__factory === 'function'
      ? (() => {
          try {
            const module = window.__factory((name) => {
              if (name === 'react') return window.__reactStub;
              if (name === 'react/jsx-runtime') return window.__jsxStub;
              if (name === 'react-dom/client') return { createRoot: () => ({ render() {} }) };
              return {};
            });
            return {
              keys: Object.keys(module).sort(),
              implId: module.IMPL_ID,
              extensions: module.EXTENSIONS,
              inject: module.inject,
              applyType: typeof module.apply,
            };
          } catch (error) {
            return { error: String(error && error.stack ? error.stack : error).slice(0, 400) };
          }
        })()
      : null,
}));

check('the bundle called the module loader', state.loaded.length === 1, JSON.stringify(state.loaded));
check('the module id is the package name', state.loaded[0]?.id === 'dsh-sidebar-editor', state.loaded[0]?.id);
check('the entry carries a factory', state.loaded[0]?.hasFactory === 'function');
check('the factory returned exports', state.exports !== null && state.exports.error === undefined, state.exports?.error);
check('exports apply', state.exports?.applyType === 'function', JSON.stringify(state.exports?.keys));
check('exports the implementation id', state.exports?.implId === 'dsh-sidebar-editor', state.exports?.implId);
check(
  'exports the claimed suffixes',
  JSON.stringify(state.exports?.extensions) === JSON.stringify(['md', 'markdown']),
  JSON.stringify(state.exports?.extensions),
);
check(
  'declares the services it injects',
  Array.isArray(state.exports?.inject) &&
    ['slots', 'locale', 'documentPreviews'].every((name) => state.exports.inject.includes(name)),
  JSON.stringify(state.exports?.inject),
);
check('loading the bundle raised no page error', errors.length === 0, errors.join(' | '));
check(
  'both halves use the same /api prefix',
  JSON.stringify(hostPrefixes) === JSON.stringify(clientPrefixes) && hostPrefixes.length === 1,
  `host ${JSON.stringify(hostPrefixes)} vs client ${JSON.stringify(clientPrefixes)}`,
);
check('the prefix is the plugin name', hostPrefixes[0] === '/api/dsh-sidebar-editor', hostPrefixes[0]);

await browser.close();
rmSync(artifacts, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log('\nartifact checks passed');
