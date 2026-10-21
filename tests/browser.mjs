/**
 * Real-Chromium test for the new editor.
 *
 * jsdom cannot answer the questions this route exists to settle: whether the
 * contenteditable takes focus, whether a mouse drag can select across blocks, what
 * Enter actually inserts, and whether the serialized Markdown that reaches the save
 * call is the Markdown a reader would expect. So the harness page is bundled and
 * driven in Chromium.
 *
 * Run: `node tests/browser.mjs`
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, '.test-artifacts');
const pageJs = join(artifacts, 'page.js');
const pageHtml = join(artifacts, 'index.html');
const fixtures = join(root, 'tests', 'fixtures');

rmSync(artifacts, { recursive: true, force: true });
mkdirSync(artifacts, { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [join(root, 'tests', 'harness', 'app.jsx')],
  outfile: pageJs,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome122'],
  jsx: 'automatic',
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"development"' },
});

const sample = readFileSync(join(fixtures, 'sample.md'), 'utf8');
const frontmatter = readFileSync(join(fixtures, 'frontmatter.md'), 'utf8');

writeFileSync(
  pageHtml,
  `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>dsh-sidebar-milkdown harness</title>
<style>html,body,#host{height:100%;margin:0}#host{width:640px}</style>
</head>
<body>
<div id="host"></div>
<script>window.__initialText = ${JSON.stringify(sample)};</script>
<script src="./page.js"></script>
</body>
</html>
`,
  'utf8',
);

const failures = [];
/** Assert one condition, recording instead of throwing so every check runs. */
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
const page = await browser.newPage({ viewport: { width: 760, height: 900 } });const consoleLines = [];
page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => consoleLines.push(`pageerror: ${error.message}`));

/**
 * Open a fake file and wait until the editor shows it.
 *
 * Waiting for `.ProseMirror` is not enough: reopening replaces the document in the
 * same element, so the old editor satisfies the selector while the new one is still
 * being created — and a click during that window lands in the wrong document.
 * @param address - the file address.
 * @param text - the file's text.
 * @param options - `{ name, writable }`.
 * @param expect - a string the rendered document must contain.
 */
async function openDoc(address, text, options, expect) {
  await page.evaluate(([a, t, o]) => window.__test.open(a, t, o), [address, text, options ?? {}]);
  await page.waitForFunction(
    (needle) => (document.querySelector('.ProseMirror')?.textContent ?? '').includes(needle),
    expect,
    { timeout: 15000 },
  );
  await page.waitForTimeout(250);
}

/**
 * Put the caret right after a text fragment through the document selection.
 *
 * A synthetic `mouse.down`/`mouse.up` pair at a computed caret point does not
 * reliably move ProseMirror's selection here (the DOM caret follows, the document
 * selection does not), so the Enter assertions would be testing Playwright's mouse
 * instead of Enter. Section 4 still drives a real click end to end; from here on the
 * caret is placed through the view's own transaction, and every keystroke is a real
 * key event.
 * @param needle - text that must exist in the document; the caret goes after it.
 */
async function placeCaretAfter(needle) {
  const result = await page.evaluate((text) => {
    const host = [...document.querySelectorAll('div')].find((element) => element.dshMilkdownView !== undefined);
    const view = host?.dshMilkdownView;
    if (view === undefined) return { ok: false, reason: 'no view' };
    let target = null;
    view.state.doc.descendants((node, pos) => {
      if (target !== null) return false;
      if (node.isText === true && node.text.includes(text)) {
        target = pos + node.text.indexOf(text) + text.length;
        return false;
      }
      return true;
    });
    if (target === null) return { ok: false, reason: 'text not found' };
    const TextSelection = view.state.selection.constructor;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)));
    view.focus();
    return { ok: true, pos: target, parent: view.state.selection.$from.parent.type.name };
  }, needle);
  if (result.ok !== true) throw new Error(`could not place the caret after "${needle}": ${result.reason}`);
  return result;
}

await page.goto(`file:///${pageHtml.replaceAll('\\', '/')}`);
await page.waitForTimeout(1500);
if ((await page.locator('.ProseMirror').count()) === 0) {
  // A mount failure is the interesting case: say what the page said, don't time out.
  console.error('the editor never mounted');
  console.error('host html:\n' + (await page.evaluate(() => document.body.innerHTML.slice(0, 4000))));
  console.error('page log:\n' + consoleLines.join('\n'));
  await browser.close();
  process.exit(1);
}

// ── 1. registration ──────────────────────────────────────────────────────────
console.log('registration');
const registration = await page.evaluate(() => {
  const [definition] = window.__test.definitions;
  return definition === undefined
    ? undefined
    : {
        id: definition.id,
        extensions: definition.extensions,
        priority: definition.priority,
        loading: definition.loading,
        wrap: definition.wrap,
        title: typeof definition.title === 'function' ? definition.title() : undefined,
      };
});
check('registers exactly one renderer', (await page.evaluate(() => window.__test.definitions.length)) === 1);
check('id is dsh-sidebar-milkdown', registration?.id === 'dsh-sidebar-milkdown', JSON.stringify(registration));
check('claims md and markdown', JSON.stringify(registration?.extensions) === JSON.stringify(['md', 'markdown']));
check("priority is 'preferred' (beats builtin)", registration?.priority === 'preferred');
check("loading mode is 'renderer'", registration?.loading === 'renderer');
check('title bound from the locale', registration?.title === '富文本编辑器', registration?.title);

// ── 2. it rendered the document ──────────────────────────────────────────────
console.log('rendering');
const rendered = await page.evaluate(() => {
  const editor = document.querySelector('.ProseMirror');
  const text = editor?.textContent ?? '';
  return {
    hasEditor: editor !== null,
    editable: editor?.getAttribute('contenteditable'),
    headings: [...document.querySelectorAll('.ProseMirror h1, .ProseMirror h2')].map((node) => node.textContent),
    paragraphs: document.querySelectorAll('.ProseMirror > p').length,
    lists: document.querySelectorAll('.ProseMirror ul').length,
    orderedLists: document.querySelectorAll('.ProseMirror ol').length,
    quote: document.querySelectorAll('.ProseMirror blockquote').length,
    codeBlocks: document.querySelectorAll('.ProseMirror pre code').length,
    tableRows: document.querySelectorAll('.ProseMirror table tr').length,
    taskBoxes: document.querySelectorAll('.ProseMirror input[type="checkbox"]').length,
    taskItems: [...document.querySelectorAll('.ProseMirror li[data-item-type="task"]')].map((node) => node.dataset.checked),
    links: [...document.querySelectorAll('.ProseMirror a')].map((node) => node.getAttribute('href')),
    strong: document.querySelectorAll('.ProseMirror strong').length,
    inlineCode: document.querySelectorAll('.ProseMirror p code').length,
    rules: document.querySelectorAll('.ProseMirror hr').length,
    literalBr: text.includes('<br>'),
    loadedCount: window.__test.loadedTokens.length,
    editableFocused: document.activeElement === editor,
  };
});
check('editor mounted', rendered.hasEditor === true);
check('contenteditable host', rendered.editable === 'true', rendered.editable);
check('h1 and h2 rendered', rendered.headings.length === 2, JSON.stringify(rendered.headings));
check('two top-level paragraphs', rendered.paragraphs === 2, String(rendered.paragraphs));
check('bullet list rendered', rendered.lists >= 1);
check('ordered list rendered', rendered.orderedLists === 1);
check('blockquote rendered', rendered.quote === 1);
check('code block rendered', rendered.codeBlocks === 1);
check('table rendered with 3 rows', rendered.tableRows === 3, String(rendered.tableRows));
check('task list items rendered', JSON.stringify(rendered.taskItems) === JSON.stringify(['true', 'false']), JSON.stringify(rendered.taskItems));
check('link href preserved', rendered.links.includes('https://example.com'), JSON.stringify(rendered.links));
check('strong rendered', rendered.strong >= 1);
check('inline code rendered', rendered.inlineCode >= 1);
check('thematic break rendered', rendered.rules === 1);
check('no literal <br> in the document', rendered.literalBr === false);
check('owner was told the version once', rendered.loadedCount === 1, String(rendered.loadedCount));

// Opening a file must not write it: the serializer normalises, and a normalised
// rewrite of a file nobody edited is data loss by another name.
await page.waitForTimeout(1500);
const savedAfterOpen = await page.evaluate(() => window.__test.saved.length);
check('opening a file writes nothing', savedAfterOpen === 0, `saves: ${savedAfterOpen}`);

// ── 2b. the stylesheet actually applies ─────────────────────────────────────
// A stylesheet whose first construct is invalid is dropped whole, taking every
// rule with it and leaving no error anywhere. These read computed values, which is
// the only way that class of failure is visible.
console.log('styles');
const styles = await page.evaluate(() => {
  const root = document.querySelector('.dsh-mk-root');
  const editor = document.querySelector('.ProseMirror');
  const pre = document.querySelector('.ProseMirror pre');
  const cell = document.querySelector('.ProseMirror td, .ProseMirror th');
  const quote = document.querySelector('.ProseMirror blockquote');
  const styleTag = document.getElementById('dsh-sidebar-milkdown-style');
  return {
    injected: styleTag !== null,
    ruleCount: styleTag === null ? 0 : styleTag.sheet?.cssRules?.length ?? 0,
    tokenText: root === null ? '' : getComputedStyle(root).getPropertyValue('--dsh-mk-text').trim(),
    fontSize: editor === null ? '' : getComputedStyle(editor).fontSize,
    preBackground: pre === null ? '' : getComputedStyle(pre).backgroundColor,
    cellBorder: cell === null ? '' : getComputedStyle(cell).borderTopWidth,
    quoteBorder: quote === null ? '' : getComputedStyle(quote).borderLeftWidth,
  };
});
check('stylesheet injected once', styles.injected === true);
check('stylesheet was not dropped', styles.ruleCount > 20, `${styles.ruleCount} rules`);
check('design tokens resolve on the root', styles.tokenText !== '', styles.tokenText);
check('body type scale applied', styles.fontSize === '14px', styles.fontSize);
check('code block has a background', styles.preBackground !== 'rgba(0, 0, 0, 0)' && styles.preBackground !== '', styles.preBackground);
check('table cells have a border', styles.cellBorder === '1px', styles.cellBorder);
check('blockquote has a bar', styles.quoteBorder === '3px', styles.quoteBorder);

// ── 3. cross-block selection (the thing the CodeMirror route could not do) ───
console.log('selection');
const dragResult = await page.evaluate(async () => {
  const editor = document.querySelector('.ProseMirror');
  const start = document.querySelector('.ProseMirror > p');
  const end = [...document.querySelectorAll('.ProseMirror > p')].at(-1);
  const before = document.createRange();
  before.setStart(start.firstChild, 3);
  before.setEnd(start.firstChild, 5);
  return { startText: start.textContent, endText: end.textContent };
});
const startBox = await page.locator('.ProseMirror > p').first().boundingBox();
const endBox = await page.locator('.ProseMirror > p').last().boundingBox();
await page.mouse.move(startBox.x + 12, startBox.y + startBox.height / 2);
await page.mouse.down();
await page.mouse.move(startBox.x + 60, startBox.y + startBox.height / 2, { steps: 4 });
await page.mouse.move(endBox.x + 40, endBox.y + endBox.height / 2, { steps: 12 });
await page.mouse.up();
const selection = await page.evaluate(() => {
  const current = window.getSelection();
  const range = current.rangeCount > 0 ? current.getRangeAt(0) : undefined;
  const blockOf = (node) => {
    let element = node?.nodeType === 1 ? node : node?.parentElement;
    while (element !== null && element !== undefined && !/^(P|H1|H2|H3|LI|BLOCKQUOTE|PRE|TD|TH)$/.test(element.tagName)) {
      element = element.parentElement;
    }
    return element?.tagName;
  };
  return {
    text: current?.toString() ?? '',
    blocks: range === undefined ? [] : [blockOf(range.startContainer), blockOf(range.endContainer)],
  };
});
check(
  'drag selects across blocks',
  selection.text.includes('\n') || selection.blocks[0] !== selection.blocks[1],
  JSON.stringify(selection),
);
check('selection text spans both paragraphs', selection.text.length > 20, String(selection.text.length));

// ── 4. Enter is a paragraph break, not a <br> ────────────────────────────────
console.log('editing');
// Click a real point at the start of the first paragraph: this is also the check
// that a click after a cross-block drag collapses the selection, because an
// un-collapsed selection is what makes Enter delete a block instead of splitting.
const firstBox = await page.locator('.ProseMirror > p').first().boundingBox();
await page.mouse.click(firstBox.x + 6, firstBox.y + firstBox.height / 2);
const afterClick = await page.evaluate(() => ({
  collapsed: window.getSelection()?.isCollapsed,
  text: window.getSelection()?.toString() ?? '',
}));
check('clicking collapses the cross-block selection', afterClick.collapsed === true, JSON.stringify(afterClick));
await page.keyboard.press('End');
const beforeEnter = await page.evaluate(() => document.querySelectorAll('.ProseMirror > p').length);
await page.keyboard.press('Enter');
await page.keyboard.type('新起一行');
const afterEnter = await page.evaluate(() => {
  const paragraphs = [...document.querySelectorAll('.ProseMirror > p')].map((node) => node.textContent);
  return {
    count: paragraphs.length,
    paragraphs,
    // ProseMirror puts a `ProseMirror-trailingBreak` <br> in an empty textblock so
    // the line box has height; that is chrome, not a hard break in the document.
    breaks: document.querySelectorAll('.ProseMirror br:not(.ProseMirror-trailingBreak)').length,
    hardbreaks: [...document.querySelectorAll('.ProseMirror p')].filter((node) => node.querySelector('br:not(.ProseMirror-trailingBreak)') !== null).length,
  };
});
check('Enter adds a paragraph', afterEnter.count === beforeEnter + 1, `${beforeEnter} → ${afterEnter.count}`);
check('typed text is in the new paragraph', afterEnter.paragraphs.some((text) => text.includes('新起一行')));
check('Enter inserted a real block break, not a <br>', afterEnter.breaks === 0, `${afterEnter.breaks} hard break(s)`);

// The caret must stay in the block: this is the IME property the old route lost.
const stillFocused = await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror') === true);
check('focus stays in the editing host', stillFocused === true);

// ── 5. auto-save writes real Markdown ───────────────────────────────────────
console.log('saving');
await page.waitForTimeout(1800);
const savedSample = await page.evaluate(() => window.__test.saved.at(-1) ?? null);
check('auto-save fired once', (await page.evaluate(() => window.__test.saved.length)) === 1);
const savedText = savedSample?.content ?? '';
if (process.env.DUMP === '1') console.log(`\nsaved markdown:\n${savedText}\n`);
check('save payload keeps the address', typeof savedSample?.address === 'string');
check('save carries a base version', typeof savedSample?.baseVersion === 'string', savedSample?.baseVersion);
check('saved Markdown has a blank line between paragraphs', savedText.includes('\n\n新起一行'), JSON.stringify(savedText.slice(0, 200)));
check('saved Markdown has no <br>', savedText.includes('<br>') === false);
check('saved Markdown keeps the heading', savedText.startsWith('# 渲染式编辑器自测'), savedText.slice(0, 40));
check('saved Markdown keeps the table', savedText.includes('| --- | --- |'), savedText.includes('| --- | --- |') ? '' : 'table lost');
check('saved Markdown keeps the fence', savedText.includes('```js'), savedText.includes('```js') ? '' : 'fence lost');
check('saved Markdown keeps the task list', /^-\s\[x\]\s/m.test(savedText), savedText.includes('[x]') ? '' : 'no [x]');
check('saved Markdown uses the file’s dash bullets', /^- 无序项一$/m.test(savedText), savedText.includes('- 无序项一') ? '' : 'bullets rewritten');
check('saved Markdown keeps a --- rule', /^---$/m.test(savedText), /^\*\*\*$/m.test(savedText) ? 'rewritten to ***' : 'rule lost');
check('saved Markdown keeps the link target', savedText.includes('(https://example.com)'));
const savedLines = savedText.split('\n').length;
check('saved Markdown has not collapsed', savedLines >= 30, `${savedLines} lines`);

// ── 6. frontmatter survives a round trip ────────────────────────────────────
console.log('frontmatter');
await openDoc('dsh-resource://file/session/test/note.md', frontmatter, { name: 'note.md' }, '正文标题');
const frontRender = await page.evaluate(() => ({
  text: document.querySelector('.ProseMirror')?.textContent ?? '',
  headings: [...document.querySelectorAll('.ProseMirror h1')].map((node) => node.textContent),
  rules: document.querySelectorAll('.ProseMirror hr').length,
}));
check('frontmatter is not rendered as body', frontRender.text.includes('title:') === false, frontRender.text.slice(0, 60));
check('body heading after frontmatter renders', frontRender.headings.includes('正文标题'), JSON.stringify(frontRender.headings));
check('frontmatter dashes are not a horizontal rule', frontRender.rules === 0, String(frontRender.rules));
await page.locator('.ProseMirror > p').first().click();
await page.keyboard.press('End');
await page.keyboard.type('（已编辑）');
await page.waitForTimeout(1800);
const savedNote = await page.evaluate(() => window.__test.saved.at(-1) ?? null);
check('frontmatter kept verbatim on save', savedNote?.content?.startsWith('---\ntitle: 带 frontmatter 的笔记\n'), (savedNote?.content ?? '').slice(0, 40));
check('frontmatter body edit saved', savedNote?.content?.includes('正文第一段。（已编辑）') === true, (savedNote?.content ?? '').slice(0, 200));
check('save count increased by one', (await page.evaluate(() => window.__test.saved.length)) === 2);

// ── 7. a read-only file cannot be written ───────────────────────────────────
console.log('read-only');
await openDoc('dsh-resource://file/session/test/locked.md', '# 只读\n\n不能改。\n', { name: 'locked.md', writable: false }, '不能改');
const readOnly = await page.evaluate(() => ({
  editable: document.querySelector('.ProseMirror')?.getAttribute('contenteditable'),
  saves: window.__test.saved.length,
}));
check('read-only file renders non-editable', readOnly.editable === 'false', readOnly.editable);

// ── 8. Enter semantics: heading, list item, Shift+Enter ─────────────────────
console.log('enter semantics');
await openDoc(
  'dsh-resource://file/session/test/enter.md',
  '# 标题\n\n- 第一项\n- 第二项\n\n段落。\n',
  { name: 'enter.md' },
  '第一项',
);

await placeCaretAfter('标题');
await page.keyboard.press('Enter');
await page.keyboard.type('标题后新段落');
const afterHeading = await page.evaluate(() => ({
  headings: [...document.querySelectorAll('.ProseMirror h1')].map((node) => node.textContent),
  paragraphs: [...document.querySelectorAll('.ProseMirror > p')].map((node) => node.textContent),
  breaks: document.querySelectorAll('.ProseMirror br:not(.ProseMirror-trailingBreak)').length,
}));
check('Enter at the end of a heading keeps one heading', afterHeading.headings.length === 1, JSON.stringify(afterHeading.headings));
check(
  'Enter at the end of a heading opens a paragraph',
  afterHeading.paragraphs.some((text) => text.includes('标题后新段落')),
  JSON.stringify(afterHeading.paragraphs),
);
check('heading Enter made no hard break', afterHeading.breaks === 0, String(afterHeading.breaks));

await placeCaretAfter('第一项');
await page.keyboard.press('Enter');
await page.keyboard.type('新的列表项');
const afterList = await page.evaluate(() => ({
  items: [...document.querySelectorAll('.ProseMirror li')].map((node) => node.textContent),
}));
check('Enter in a list item adds an item', afterList.items.length === 3, JSON.stringify(afterList.items));
check('the new item is the typed one', afterList.items[1]?.includes('新的列表项') === true, JSON.stringify(afterList.items));

// Shift+Enter must behave like Enter: the CodeMirror route's `<br>` problem must
// not come back through the other door.
await placeCaretAfter('段落。');
await page.keyboard.press('Shift+Enter');
await page.keyboard.type('换行后的文字');
const afterShift = await page.evaluate(() => ({
  paragraphs: [...document.querySelectorAll('.ProseMirror > p')].map((node) => node.textContent),
  breaks: document.querySelectorAll('.ProseMirror br:not(.ProseMirror-trailingBreak)').length,
}));
check('Shift+Enter makes a block, not a hard break', afterShift.breaks === 0, String(afterShift.breaks));
check(
  'Shift+Enter text is in its own paragraph',
  afterShift.paragraphs.some((text) => text.trim() === '换行后的文字'),
  JSON.stringify(afterShift.paragraphs),
);

await page.waitForTimeout(1800);
const savedEnter = await page.evaluate(() => window.__test.saved.at(-1) ?? null);
const enterText = savedEnter?.content ?? '';
if (process.env.DUMP === '1') console.log(`\nenter markdown:\n${enterText}\n`);
check('enter round trip has no hard-break syntax', /\\\n| {2}\n|<br>/.test(enterText) === false, JSON.stringify(enterText));
check('list kept its item count in markdown', (enterText.match(/^- /gm) ?? []).length === 3, JSON.stringify(enterText));
check('heading stayed a heading in markdown', enterText.startsWith('# 标题\n'), JSON.stringify(enterText.slice(0, 20)));
check('heading paragraph is a separate block', enterText.includes('标题后新段落\n'), JSON.stringify(enterText));

// ── screenshots for the visual check ────────────────────────────────────────
const shots = join(root, 'tests', 'shots');
mkdirSync(shots, { recursive: true });
await openDoc('dsh-resource://file/session/test/sample.md', sample, { name: 'sample.md' }, '渲染式编辑器自测');
await page.waitForTimeout(500);
await page.screenshot({ path: join(shots, 'editor-sample.png'), fullPage: false });

await browser.close();

if (consoleLines.length > 0) {
  console.log('\npage log');
  for (const line of consoleLines.slice(0, 20)) console.log(`  ${line}`);
}

rmSync(artifacts, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const name of failures) console.error(`  - ${name}`);
  process.exit(1);
}
console.log('\nall browser checks passed');
