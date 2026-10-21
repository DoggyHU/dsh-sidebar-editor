# 状态与决策（0.1.0，2026-10-21 夜）

这份文件记录"为什么这么做"和"踩过什么坑"，避免下一次会话重新推导一遍。

---

## 一、当前状态

| 项 | 值 |
|---|---|
| 版本 | 0.1.0 |
| 产物 | `lib/client.js` 1052.2 KB（130 个打包包） |
| 依赖 | `@milkdown/kit` 7.22.3（含 `@milkdown/core`、`preset-commonmark`、`preset-gfm`、`plugin/history`、`plugin/listener`、`prose/*`） |
| 测试 | `pnpm test`：打包契约 9 项 + 行为 40 项，全绿；连跑 3 次稳定 |
| profile | 已挂进 `~/.dsh/profiles/desktop`，`dsh-sidebar-editor` **已从 bundles 移除**（依赖项保留，恢复只需一行） |

---

## 二、为什么不接着改旧插件

旧插件是"CodeMirror 文档 + 每块一个 React 渲染 + 浏览器 `contenteditable`"，同一片 DOM 有三个主人：

1. CodeMirror 管 offset / 布局；
2. React 管子树重建；
3. 浏览器管光标与输入法。

v1.0.11 把症状压住了（回车只在块内切 DOM、不 dispatch、不搬焦点；写回攒批并在 dispatch 时才解析范围），但每一类 bug 都出自这个结构。ProseMirror 是"一个模型 + 一个视图"，输入法、跨段落选区、回车、写回都由编辑器自己保证，插件只需读写 Markdown。

**新插件不改旧插件**：旧目录是"能用"的基线，一行没动。

---

## 三、关键机制（不要回退）

### 3.1 排序：`preferred` 才能当默认视图

注册表排序（官方 `documentpreviews/lib/client.js`）：

```js
rank = priority === 'builtin' ? 0 : 1
sort: rank 降序 → 匹配后缀长度降序 → 注册顺序升序
```

所以 `'preferred'` 一定排在官方 `builtin` 前，成为 `.md` 默认视图；两个 `'preferred'` 之间由**注册顺序**决定——这就是为什么旧插件必须从 bundles 移除：它自己也注册了一个 `'preferred'` 的 md 渲染器，且先注册。

### 3.2 不要把 Milkdown 的空段落占位写进文件

`preset-commonmark` 的 `remarkPreserveEmptyLinePlugin` 会给空段落写 `<br />`（`EMPTY_LINE_PLACEHOLDER`）。官方预览不渲染裸 HTML，重开就变成字面 `<br />`——正是用户明确拒绝的东西。所以 `editor.js` 把这对插件从 preset 里滤掉：

```js
const COMMONMARK = commonmark.filter((p) => !EMPTY_LINE_PLUGINS.has(p));
```

代价：空段落在保存后消失（它本来就没有 Markdown 表示）。

### 3.3 回车语义

| 位置 | 行为 | 实现 |
|---|---|---|
| 段落 | 拆成两个段落 | 默认 `baseKeymap` 的 `splitBlock` |
| 标题 | 标题 + **段落** | `splitHeading()`：`splitBlock` 后把后半块 `setBlockType(paragraph)` |
| 列表项 | 两项 | preset 的 `listItemKeymap`（`splitListItem`） |
| 代码块 | 代码换行 | `newlineInCode` |
| Shift+Enter | **等同 Enter** | `handleKeyDown` 拦下，走 `splitLikeEnter()` |

Shift+Enter 必须拦：ProseMirror 的 baseKeymap 让它插 `hardbreak` 节点，序列化会变成行尾反斜杠或 `<br>`。用户的规则是"换行就是新块，块内不出现硬回车"。

`splitHeading()` 一旦 dispatch 就**必须返回 true**：返回 false 会让 ProseMirror 继续跑 base keymap，在已经改过的 state 上再切一次（实测表现为标题被切成两半、后面多出空块）。

### 3.4 序列化选项

`remark-stringify` 默认用 `*` 项目符号、`***` 分隔线，会把一份 `-` 风格的文件在第一次编辑后整篇改写。`editor.js` 里改回：

```js
bullet: '-', bulletOther: '*', rule: '-', emphasis: '*', strong: '*', fence: '`'
```

（`bullet` 与 `bulletOther` 必须不同，否则 remark 直接抛错——踩过。）

表格仍会被 `remark-gfm` 补齐单元格空格（`| 1   | 2   |`），这是它的序列化方式，可接受。

### 3.5 frontmatter 原样保留

schema 里没有 frontmatter 节点，直接解析会把 `---` 变成分隔线、把键值变成正文。`editor.js` 的 `splitFrontmatter` / `joinFrontmatter` 把开头块**整段**留出来，编辑正文，保存时拼回去。测试里有真实用例（`tests/fixtures/frontmatter.md`）。

### 3.6 打开不写盘

Milkdown 的往返是规范化的，所以底稿 `baseline = readMarkdown(在刚加载的文档上)`，不是文件原文。否则"只是打开一个文件"就会因为规范化差异触发一次自动保存。测试项：`opening a file writes nothing`。

### 3.7 样式表必须放在规则里

`src/client/theme.js` 的 CSS 变量块必须以 `.dsh-mk-root { … }` 开头。**顶层写 `--x: y;` 不是合法规则，整张表会被丢弃**，症状是"边框、代码块底色、引用条全没了，而且没有任何报错"。测试里有一组读 `getComputedStyle` 的断言专门盯这个（`stylesheet was not dropped`、`code block has a background`、`table cells have a border`）。

---

## 四、测试与它们各自的盲区

`pnpm test` = `tests/artifact.mjs` + `tests/browser.mjs`，都在真实 Chromium（`%LOCALAPPDATA%\ms-playwright\chromium-1208`）。

- `artifact.mjs`：按真实方式加载 `lib/client.js`（`window.__ModuleLoader__.load({id, factory})`），检查 id、工厂、导出面、`inject`、后缀，以及**宿主半与浏览器半的 `/api` 前缀一致**（不一致时 UI 只会说"文件服务不可用"）。
- `browser.mjs`：把 `tests/harness/app.jsx` 打包，用假 `ctx`（slots/locale/documentPreviews/effect）挂载渲染体，`fetch` 拦截到假文件表。覆盖：注册元数据、渲染结果、样式落地、跨块拖选、回车四种位置、Shift+Enter、自动保存的 Markdown、frontmatter 往返、只读文件。

**盲区（必须记住）**：

1. `page.mouse.click()` 在计算出的 caret 点上**不能可靠地移动 ProseMirror 的文档选区**（DOM 选区动了、`view.state.selection` 没动）。所以 `browser.mjs` 里跨块拖选和第一次点击用真实鼠标，之后定位光标用调试句柄 `view.dispatch(setSelection)`（`placeCaretAfter`）。**真实用户用真鼠标没有这个问题，但没有在真机上验证过点击落点**。
2. 输入法（IME）无法在无头浏览器里真实模拟。旧路线 v1.0.11 的乱入问题是靠"焦点不离开块"解决的；新路线由 ProseMirror 自己处理 composition，理论上更稳，但**需要人工在真机打字验证一次中文输入**。
3. 测试页面没有 DSH 的 CSS 令牌，用的是 `theme.js` 里的兜底颜色。真机上是令牌色。

调试句柄：`mountMilkdown` 在 `globalThis.__DSH_MILKDOWN_DEBUG__ === true` 时把 `editor` / `view` 挂到根元素上（`dshMilkdownEditor` / `dshMilkdownView`），仅测试用。

---

## 五、下一步（按价值排序）

1. **真机验收**：重启 DSH → 打开一个 `.md` → 看默认视图是不是新编辑器 → 中文输入法在段首/段中/换行处各打一遍 → 跨段落拖选 → 保存后看文件 diff。
2. 旧插件那套**批注**（选中文本 → 注释 → 发到对话输入框）移植到新路线：ProseMirror 的选区天然带位置映射，比旧版准确得多。
3. 恢复/重建**代码编辑器**能力（非 md 文件）。旧插件停用后这块回落到官方「代码」视图；如果还想要 CodeMirror，可以做成同一插件里的另一个 `builtin` 优先级实现。
4. 空段落若要保留，需要自定义序列化（例如写成 HTML 注释占位再在打开时还原），代价是污染文件；**先不做**。

---

## 六、操作纪律

- 别为了新插件去改 `dsh-sidebar-editor`（它是对照基线）。
- 没得到明确指令不要推 GitHub（`dsh-sidebar-editor` 已推到 `DoggyHU/dsh-sidebar-editor`；本插件只在本地）。
- 改代码后必须 `pnpm test`（两段都是浏览器级），再 `pnpm build`。
