# 状态与决策（0.2.0，2026-10-22 凌晨）

这份文件记录"为什么这么做"和"踩过什么坑"，避免下一次会话重新推导一遍。

---

## 一、当前状态

| 项 | 值 |
|---|---|
| 版本 | 0.2.0 |
| 产物 | `lib/client.js` 1066.6 KB（130 个打包包） |
| 依赖 | `@milkdown/kit` 7.22.3（含 `@milkdown/core`、`preset-commonmark`、`preset-gfm`、`plugin/history`、`plugin/listener`、`prose/*`） |
| 测试 | `pnpm test`：宿主半 27 项 + 打包契约 11 项 + 行为 103 项，全绿；行为套件连跑 3 次稳定 |
| profile | 已挂进 `~/.dsh/profiles/desktop`，`dsh-sidebar-editor` **已从 bundles 移除**（依赖项保留，恢复只需一行） |

### 0.2.0 改了什么（用户四条反馈）

| # | 反馈 | 处理 |
|---|---|---|
| 1 | 中文输入法被打断：候选词过一会儿消失、拼音直接进文档 | 删掉 900ms 定时自动保存（`AUTO_SAVE_MS` 整套移除）；组词期间（`view.composing`）**不做任何 React 状态更新** |
| 2 | 保存后光标消失、退出编辑状态 | 根因不是保存本身，是 `revision` 变化时**销毁重建编辑器**（丢焦点=掐断输入法）。改成就地合并，永不重建 |
| 3 | 表格没有＋行/＋列 | 加「＋行 / ＋列」浮层按钮（光标在表格内或悬停表格时出现在右上角）；不抢焦点 |
| 4 | 字体不跟随 DSH 设置 | 排版整段照抄官方 `._markdown_*` 规则，用 `--dsw-font-markdown-*` 令牌，改设置时一起变 |
| 5 | 保存后文档跳回最上面 | 两处：`replaceBody` 原来把光标钉在文档开头（PM 会把光标滚进视口）→ 改成保持原光标附近；另外用**模块级 `scrollPositions`** 记住每个文件的阅读位置，重建/替换后还原 |
| 6 | 存过五版之后，切到对话框再保存就报「磁盘已变更」 | 一次手势会同时触发多个保存点（点聊天框 = pointerdown + blur），两次写带着同一个版本号 → 后一次必然冲突。改成**串行队列**（`saveChainRef`），并且冲突回包里如果磁盘字节**正好等于我们这次要写的内容**，就当作成功（stale token，不是真冲突） |
| 7 | 字体是衬线体 | 0.2.0 用 `font:` 简写 + 令牌，令牌缺一个就整条失效；而且 DSH 的 `--dsw-font-family` 可能只有拉丁字体，中文就落到 Chromium 的**标准字体**（= 宋体）。改成**长写属性** + `--dsh-mk-font-stack`（app family 后面显式追加 `"Microsoft YaHei" / "PingFang SC" / "Noto Sans CJK SC"`），并在客户端上报里记下解析后的 `fontFamily` 与令牌值，写到 `%TEMP%\dsh-sidebar-milkdown-report.json` |

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

### 3.2 保存只有一个理由：用户做完了

**没有定时自动保存。** 0.1.0 有一个 900ms 的"停止输入就写"定时器，实测后果正是用户报的：打到一半它动手，候选词消失、拼音被当英文提交。0.2.0 的触发点是：

| 触发 | 代码位置 |
|---|---|
| Ctrl/Cmd+S | `MilkdownBody` 的 document keydown（capture，先于 ProseMirror） |
| 焦点离开编辑器 | Milkdown `listenerCtx.blur` |
| 编辑器外任意 pointerdown / keydown | document 捕获阶段，判断 `view.dom.contains(target)` |
| 页面隐藏 / 卸载 | `visibilitychange` / `pagehide` |
| 视图销毁、换文件 | mount effect 的 cleanup |
| 关窗口时还有未保存内容 | `beforeunload` 确认框 |

保存前必须先 `flushPendingInput(editor)`（`view.domObserver.forceFlush()`）：Milkdown 的 `markdownUpdated` 是 **200ms 防抖**，而且 DOM 层改动（IME 提交、自动化 `insertText`）要等 DOMObserver 那一拍才进 state。不 flush 就会"存上一拍的内容"——踩过，表现为 Ctrl+S 看起来没保存。

### 3.3 `revision` 变化必须就地合并，绝不重建编辑器

这是"保存后光标消失、退出编辑状态"的真正原因：官方预览在文件变化后会推一个新 `revision`，0.1.0 的做法是销毁再重建 Milkdown 编辑器 → 焦点丢失、IME 组合被掐断。

0.2.0 的规则（`revision` 的那个 effect）：

1. `open` 一次，拿到磁盘上的文本和版本号；
2. `flushPendingInput` 后读**文档里的**缓冲区，判断 dirty；
3. 如果磁盘文本 == 我们上次写的（`joinFrontmatter(front, buffer)`）→ 只换版本号，什么都不动；
4. 如果缓冲区 dirty → 只弹横幅提示，缓冲区一个字都不动；
5. 否则 → `replaceBody(editor, …)` 就地替换（`tr.replaceWith(0, size, parsed.content)`），仍不重建视图。

测试覆盖：`an owner revision does not recreate the editor node` / `keeps the caret` / `keeps the edit` / `external change is adopted without recreating` / `external change while dirty keeps the buffer`。

**另一个坑（0.2.0 修）**：换文件时，新一次 render 先把 `saveRef.current` 重绑到新地址，之后旧 effect 的 cleanup 才跑——于是"把旧文件的缓冲区写进新文件"。修法是 cleanup 用 effect 里捕获的 `save`，并且在 `save()` 里校验 `held.address === address`。

### 3.4 输入法（IME）三条规矩

1. 组词期间不碰 DOM：`positionTableTools()` 一见 `view.composing` 直接 return；
2. 组词期间不 setState：`markdownUpdated` 的第二个参数把 `composing` 传进来，`handleChange` 只更新 ref、不更新状态；
3. 组词期间不保存：没有定时器，所以不存在"它自己动手"这件事。

### 3.5 不要把 Milkdown 的空段落占位写进文件

`preset-commonmark` 的 `remarkPreserveEmptyLinePlugin` 会给空段落写 `<br />`（`EMPTY_LINE_PLACEHOLDER`）。官方预览不渲染裸 HTML，重开就变成字面 `<br />`——正是用户明确拒绝的东西。所以 `editor.js` 把这对插件从 preset 里滤掉：

```js
const COMMONMARK = commonmark.filter((p) => !EMPTY_LINE_PLUGINS.has(p));
```

代价：空段落在保存后消失（它本来就没有 Markdown 表示）。

### 3.7 一次手势 = 多个保存点

点聊天框会同时产生 `pointerdown`（我们的 document 捕获监听）和 `blur`（Milkdown 的 listener）。
两个保存点若并行发出，第二次携带的还是第一次之前的版本号 → host 判 `FS_STALE_VERSION` → 界面报
「磁盘已变更」，而磁盘上的内容其实已经是自己刚写的那版。

两道防线：

1. `saveChainRef`：保存串行排队（`saveChainRef.current.then(...)`），第二次一定在第一次提交完之后跑，
   此时 `docRef.version` 已更新；
2. 冲突自愈：`conflict` 回包里 `current.text` 若与"这次本来要写的内容"逐字节相同，就当作成功
   （换用 `current.version`），不报冲突、不暂停。

真正的冲突（磁盘真的是别人改的）照旧停止并给「覆盖磁盘 / 重新加载」。

### 3.8 字体：长写属性 + 显式 CJK 兜底

两件事叠在一起才会变成"衬线体"：

1. `font: var(--token)` 是**简写**：令牌缺失时整条声明失效，回退到继承/浏览器默认；
2. `--dsw-font-family` 若只有拉丁字体，中文没有字形，Chromium 用**标准字体**兜底，而标准字体是衬线（宋体）。

所以 `.dsh-mk-surface` 用长写属性（`font-family` / `font-size` / `font-weight` / `line-height`，
分别对应主题的 `--dsw-font-markdown-base-font-*`），且 `--dsh-mk-font-stack` 在 app family 之后显式追加
`"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`。app 自己的 family 里有 CJK 时它优先，
所以"跟随设置"没有被破坏。

排查手段：客户端把解析后的 `fontFamily` 和主题令牌值写进上报，落盘在
`%TEMP%\dsh-sidebar-milkdown-report.json` 的 `font` 字段——真机再出现"看着不对"，读这个文件即可，不用猜。

### 3.9 回车语义

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

`pnpm test` = `tests/host.mjs` + `tests/artifact.mjs` + `tests/browser.mjs`。

- `host.mjs`：在假 ctx（`connection.fetch.register` / `fs` / `sessions` / `sandboxPolicy` / `effect` / `inject`）上挂 `apply()`，断言 6 条路由注册、`open` 的文本/版本/行尾/BOM/沙箱模式、`save` 的版本校验与冲突回包、工作区外只读与拒写、CRLF+BOM 往返。
- `artifact.mjs`：按真实方式加载 `lib/client.js`（`window.__ModuleLoader__.load({id, factory})`），检查 id、工厂、导出面、`inject`、后缀，以及**宿主半与浏览器半的 `/api` 前缀一致**（不一致时 UI 只会说"文件服务不可用"）。
- `browser.mjs`：把 `tests/harness/app.jsx` 打包，用假 `ctx`（slots/locale/documentPreviews/effect）挂载渲染体，`fetch` 拦截到假文件表。覆盖：注册元数据、渲染结果、样式落地（含读 `getComputedStyle`）、跨块拖选、回车四种位置、Shift+Enter、**没有定时保存**、Ctrl+S/失焦/点外部触发保存、保存后节点与光标不丢、`revision` 不重建、外部改动就地合并/脏时只提示、**保存后阅读位置不跳**、frontmatter 往返、只读文件、表格＋行/＋列。

**盲区（必须记住）**：

1. `page.mouse.click()` 在计算出的 caret 点上**不能可靠地移动 ProseMirror 的文档选区**（DOM 选区动了、`view.state.selection` 没动）。所以 `browser.mjs` 里跨块拖选和第一次点击用真实鼠标，之后定位光标用调试句柄 `view.dispatch(setSelection)`（`placeCaretAfter`）。**真实用户用真鼠标没有这个问题，但没有在真机上验证过点击落点**。
2. 输入法（IME）无法在无头浏览器里真实模拟。旧路线 v1.0.11 的乱入问题是靠"焦点不离开块"解决的；新路线由 ProseMirror 自己处理 composition，且 0.2.0 在组词期间完全不动 React，理论上更稳，但**需要人工在真机打字验证一次中文输入**。
3. 测试页面没有 DSH 的 CSS 令牌，用的是 `theme.js` 里的兜底颜色。真机上是令牌色。

调试句柄：`mountMilkdown` 在 `globalThis.__DSH_MILKDOWN_DEBUG__ === true` 时把 `editor` / `view` 挂到根元素上（`dshMilkdownEditor` / `dshMilkdownView`），仅测试用。

---

## 五、查证：为什么 `dsh-quote-annotate-pro` 的划词批注在本编辑器里不生效

结论：**门槛在批注插件里，不在我们这里**。

`dsh-quote-annotate-pro/lib/client.js` 的选区计算（`compute()`，约 1559 行）有一条硬规则：

```js
const host = node && node.nodeType === 1 ? node : (node ? node.parentElement : null)
if (host && host.closest('textarea, input, [contenteditable="true"]')) {
  scheduleHide()   // 选区在任何可编辑区域里就不弹气泡
  return
}
```

它的本意是别在聊天输入框里弹气泡，但这条选择器把**所有** `contenteditable` 一起挡了；Milkdown 的编辑宿主正是 `contenteditable="true"`，所以选区一落在编辑器里气泡就被隐藏。DSH 其它地方是普通只读 DOM（`.markdown` 那类），不命中这条，所以到处能用。

要改的是批注插件（我们这边怎么改都会被这条挡住，除非放弃 contenteditable，那不可能）。最小改法 3–5 行：

```js
// 只挡聊天输入框和真正的表单控件，放行被显式标记的编辑器
if (host && host.closest('textarea, input')) return hide()
const editable = host && host.closest('[contenteditable="true"]')
if (editable && !editable.hasAttribute('data-dshq-annotate')) return hide()
```

然后本插件在编辑宿主上加一个属性（`editor.js` 的 `editorViewOptionsCtx.attributes` 加 `'data-dshq-annotate': 'true'`，一行）。这样双方各改一点点，且以后谁也不会误放行。

**前提**：`dsh-quote-annotate-pro` 目录里只有 `lib/client.js`（107 KB 构建产物），没有 `src`。要么找到源码重新构建，要么在产物里做这一处外科手术（代码未压缩、很好改，但下次重建会丢）。所以"动作大不大"的答案是：**逻辑上很小，工程上取决于源码在不在手上**。

---

## 六、下一步（按价值排序）

1. **真机验收**：重启 DSH → 打开一个 `.md` → 中文输入法在段首/段中/换行处各打一遍 → 跨段落拖选 → 保存后看文件 diff 和阅读位置。
2. 批注联动（见第五节）：批注插件放行 `[data-dshq-annotate]`，本插件加属性。
3. 恢复/重建**代码编辑器**能力（非 md 文件）。旧插件停用后这块回落到官方「代码」视图；如果还想要 CodeMirror，可以做成同一插件里的另一个 `builtin` 优先级实现。
4. 空段落若要保留，需要自定义序列化（例如写成 HTML 注释占位再在打开时还原），代价是污染文件；**先不做**。

---

## 七、操作纪律

- 别为了新插件去改 `dsh-sidebar-editor`（它是对照基线）。
- 没得到明确指令不要推 GitHub（`dsh-sidebar-editor` 已推到 `DoggyHU/dsh-sidebar-editor`；本插件只在本地）。
- 改代码后必须 `pnpm test`（两段都是浏览器级），再 `pnpm build`。
