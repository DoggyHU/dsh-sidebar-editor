# 状态与决策（1.0.0，2026-10-22 下午）

这份文件记录"为什么这么做"和"踩过什么坑"，避免下一次会话重新推导一遍。

---

## 一、当前状态

| 项 | 值 |
|---|---|
| 版本 | 1.2.1（**两个视图**：富文本 + 源码；1.2.1 = 标签右键菜单可批量关闭（含服务取用方式的修正）） |
| 产物 | `lib/client.js` 2761.3 KB（171 个打包包） |
| 依赖 | `@milkdown/kit` 7.22.3 + CodeMirror 6 一整套（`state`/`view`/`language`/`commands`/`search`/13 个 `lang-*`/`legacy-modes`/`@lezer/highlight`）；`pnpm.overrides` 钉死核心单副本（见第八节坑 A） |
| 测试 | `pnpm test`：宿主半 34 项 + 打包契约 11 项 + 行为 157 项，全绿 |
| profile | 已挂进 `~/.dsh/profiles/desktop`（`link:D:/Coding_Plan/DSH_Plugin_insNdev/dsh-sidebar-editor`），`bundles` 里只有本插件 |
| 仓库 | https://github.com/DoggyHU/dsh-sidebar-editor （public，tag `v0.1.0` / `v0.2.0` / `v0.2.1` / `v0.2.2` / `v0.3.0` / `v1.0.0`） |
| 回退 | 想要回 0.2.2 的单一富文本视图：`git checkout v0.2.2 -- src lib && pnpm build`；0.3.0 的"三个条目、两视图"是 `v0.3.0`；改名前的磁盘快照在 `_backup\dsh-sidebar-milkdown-0.2.2-20261022` |

### 1.0.0 做了什么：改名 + 接任 `dsh-sidebar-editor`

| 项 | 旧 | 新 |
|---|---|---|
| 包名 / 实现 id | `dsh-sidebar-milkdown` | **`dsh-sidebar-editor`**（另有 `-code` / `-code-shipped`） |
| 路由前缀 | `/api/dsh-sidebar-milkdown` | **`/api/dsh-sidebar-editor`** |
| cordis bundle 行 | `sidebar-milkdown` | **`sidebar-editor`** |
| locale 命名空间 | `dshSidebarMilkdown` | **`dshSidebarEditor`** |
| CSS 前缀 | `--dsh-mk-*` / `.dsh-mk-*` | **`--dsh-se-*` / `.dsh-se-*`** |
| 日志 / 报告 | `%TEMP%\dsh-sidebar-milkdown-*` | **`%TEMP%\dsh-sidebar-editor-*`** |
| 环境变量 | `DSH_SIDEBAR_MILKDOWN_*` | **`DSH_SIDEBAR_EDITOR_*`** |
| 本地目录 | `…\dsh-sidebar-milkdown` | **`…\dsh-sidebar-editor`** |

旧插件（同名 1.0.x，渲染块 + contenteditable 那条路线）的 GitHub 仓库**已彻底删除**（先改名为 `dsh-sidebar-editor-retired` 归档，再由用户手动删除）；本地也已无副本，唯一留存是 `_backup\repos-20261022\` 里的 mirror + bundle。它原本的 1.0.x 版本号作废，新的 1.0.0 由这一版继承——所以"1.0.x"现在只有一条线。

### 0.2.0 改了什么（用户四条反馈）

| # | 反馈 | 处理 |
|---|---|---|
| 1 | 中文输入法被打断：候选词过一会儿消失、拼音直接进文档 | 删掉 900ms 定时自动保存（`AUTO_SAVE_MS` 整套移除）；组词期间（`view.composing`）**不做任何 React 状态更新** |
| 2 | 保存后光标消失、退出编辑状态 | 根因不是保存本身，是 `revision` 变化时**销毁重建编辑器**（丢焦点=掐断输入法）。改成就地合并，永不重建 |
| 3 | 表格没有＋行/＋列 | 加「＋行 / ＋列」浮层按钮（光标在表格内或悬停表格时出现在右上角）；不抢焦点 |
| 4 | 字体不跟随 DSH 设置 | 排版整段照抄官方 `._markdown_*` 规则，用 `--dsw-font-markdown-*` 令牌，改设置时一起变 |
| 5 | 保存后文档跳回最上面 | 两处：`replaceBody` 原来把光标钉在文档开头（PM 会把光标滚进视口）→ 改成保持原光标附近；另外用**模块级 `scrollPositions`** 记住每个文件的阅读位置，重建/替换后还原 |
| 6 | 存过五版之后，切到对话框再保存就报「磁盘已变更」 | 一次手势会同时触发多个保存点（点聊天框 = pointerdown + blur），两次写带着同一个版本号 → 后一次必然冲突。改成**串行队列**（`saveChainRef`），并且冲突回包里如果磁盘字节**正好等于我们这次要写的内容**，就当作成功（stale token，不是真冲突） |
| 7 | 字体是衬线体 | 0.2.0 用 `font:` 简写 + 令牌，令牌缺一个就整条失效；而且 DSH 的 `--dsw-font-family` 可能只有拉丁字体，中文就落到 Chromium 的**标准字体**（= 宋体）。改成**长写属性** + `--dsh-se-font-stack`（app family 后面显式追加 `"Microsoft YaHei" / "PingFang SC" / "Noto Sans CJK SC"`），并在客户端上报里记下解析后的 `fontFamily` 与令牌值，写到 `%TEMP%\dsh-sidebar-editor-report.json` |
| 8 | 编辑器底色是灰蓝色，看着割裂 | 原来用官方预览的阅读底色 `--dsw-alias-bg-document-preview`（浅色下是 bluish-100，灰蓝）。改成 **`--dsw-alias-bg-base`**：浅色是 bluish-00（纯白），深色是 bluish-950（近黑），主题切换自动跟随。代价是代码块/表头在浅色下与页面同色，所以给 `pre` 补了一条 hairline 边框 |

---

## 二、为什么不接着改旧插件

旧插件是"CodeMirror 文档 + 每块一个 React 渲染 + 浏览器 `contenteditable`"，同一片 DOM 有三个主人：

1. CodeMirror 管 offset / 布局；
2. React 管子树重建；
3. 浏览器管光标与输入法。

v1.0.11 把症状压住了（回车只在块内切 DOM、不 dispatch、不搬焦点；写回攒批并在 dispatch 时才解析范围），但每一类 bug 都出自这个结构。ProseMirror 是"一个模型 + 一个视图"，输入法、跨段落选区、回车、写回都由编辑器自己保证，插件只需读写 Markdown。

**当时刻意不改旧插件**：旧目录被当成"能用"的基线，一行没动；它现在已整体退役并被删除。

---

## 三、关键机制（不要回退）

### 3.1 排序：`preferred` 才能当默认视图

注册表排序（官方 `documentpreviews/lib/client.js`）：

```js
rank = priority === 'builtin' ? 0 : 1
sort: rank 降序 → 匹配后缀长度降序 → 注册顺序升序
```

所以 `'preferred'` 一定排在官方 `builtin` 前，成为 `.md` 默认视图；两个 `'preferred'` 之间由**注册顺序**决定——这也是当时必须把旧插件从 bundles 移除的原因：它自己也注册了一个 `'preferred'` 的 md 渲染器，且先注册。

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

所以 `.dsh-se-surface` 用长写属性（`font-family` / `font-size` / `font-weight` / `line-height`，
分别对应主题的 `--dsw-font-markdown-base-font-*`），且 `--dsh-se-font-stack` 在 app family 之后显式追加
`"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif`。app 自己的 family 里有 CJK 时它优先，
所以"跟随设置"没有被破坏。

排查手段：客户端把解析后的 `fontFamily` 和主题令牌值写进上报，落盘在
`%TEMP%\dsh-sidebar-editor-report.json` 的 `font` 字段——真机再出现"看着不对"，读这个文件即可，不用猜。

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

`src/client/theme.js` 的 CSS 变量块必须以 `.dsh-se-root { … }` 开头。**顶层写 `--x: y;` 不是合法规则，整张表会被丢弃**，症状是"边框、代码块底色、引用条全没了，而且没有任何报错"。测试里有一组读 `getComputedStyle` 的断言专门盯这个（`stylesheet was not dropped`、`code block has a background`、`table cells have a border`）。

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
3. ~~恢复/重建**代码编辑器**能力（非 md 文件）~~ —— **0.3.0 已做**：同一插件里第二个 `documentPreviews` 实现，见第八节。
4. 空段落若要保留，需要自定义序列化（例如写成 HTML 注释占位再在打开时还原），代价是污染文件；**先不做**。

---

## 七、操作纪律

- 旧插件（1.0.x 那条渲染块路线）已删除，不要试图复活它：它的死因是结构性的（写回吞块、tile 崩溃），本仓库只搬了它的纯文本编辑器部分。
- 没得到明确指令不要推 GitHub（`dsh-sidebar-editor` 已推到 `DoggyHU/dsh-sidebar-editor`；本插件只在本地）。
- 改代码后必须 `pnpm test`（两段都是浏览器级），再 `pnpm build`。

---

## 八、0.3.0：把 CodeMirror 代码视图接回来

### 8.1 用户拍板的四条

| 决策 | 结论 |
|---|---|
| 下拉顺序 | **Milkdown（`.md`）→ CodeMirror → 官方原生** |
| 保存语义 | 统一用富文本那套（无定时器）；CodeMirror 只是"多一个选项"，尤其针对代码类文件 |
| 切换视图的读时序 | 要保证"先写完再读" |
| 代码文件默认视图 | 改成可编辑的 CodeMirror（官方只读「代码」视图退到下拉里） |
| 草稿（localStorage） | **删掉**（保存点已覆盖所有退出路径） |
| 语法表 | **全量照搬**，不裁剪 |

### 8.2 形状：一个插件、三次注册（两个视图）

```
id = dsh-sidebar-editor                ext = md,markdown      preferred   body = MilkdownBody
id = dsh-sidebar-editor-code           ext = 115 后缀减 4     preferred   body = SourceBody
id = dsh-sidebar-editor-code-shipped   ext = html,htm,svg,csv builtin     body = SourceBody（同一个组件，另一个 slot key）
```

rank 只看 `priority === 'builtin' ? 0 : 1`，所以前两个是第 1 档；`.md` 上两者后缀长度相同，**靠注册顺序**决定谁是 `candidates[0]`。
→ 三次 `register` 必须写在**同一个 `ctx.effect` 里、富文本在前**（拆成多个 effect 就等于把默认视图交给打包/加载顺序）。
`reportToHost` 会把 `probe.md` / `probe.py` / `probe.html` / `probe.svg` / `probe.csv` 的 `candidates()` 顺序一起上报到 `%TEMP%\dsh-sidebar-editor-report.json`，排序错了能查（测试里也断言了这三条的期望值）。

**为什么第三个条目必须存在**：一个实现只有一个优先级档，而 `.html`/`.svg`/`.csv` 是产品自己渲染得更好的（页面 / 图片 / 表格）。
如果把它们放进第 1 档，`.svg` 会默认以文本打开、`.csv` 会丢掉表格视图 —— 那不是"编辑代码"，是退化。
所以拆成"抢默认的一档"+"跟官方同档、只在下拉里出现"的一档。两档的后缀表必须**互不重叠**（重叠会让同一个文件在下拉里出现两次"源代码"），测试里有一条断言守着。
想改成"所有后缀都抢默认"，把 `PRODUCT_RENDERED_EXTENSIONS` 并进 `SOURCE_EXTENSIONS`、删掉第三条注册即可。

对源码后缀用第 1 档的后果：**`.py` 等文件默认视图变成可编辑 CodeMirror**，官方只读「代码」视图退到下拉第二项。这是用户明确要的。

### 8.3 三个坑（都已在测试里固化）

**坑 A：CodeMirror 核心出现两份副本 → 语法高亮静默失效。**
`@codemirror/language` 被装成 6.13.1（`lang-*` 要的）和 6.12.4（我们自己钉的）两份，`@codemirror/view` 同样是 6.43.15 / 6.43.13 两份。
后果：`language` facet 是 A 副本的、`syntaxHighlighting` 的 state field 是 B 副本的，两者互不认识 —— **文字正常显示、一个 `<span>` 都没有、不报错**。
修法：`package.json` 的 `pnpm.overrides` 把 `@codemirror/language`/`view`/`state`/`@lezer/common`/`@lezer/highlight` 各钉一份，装完只留单副本（产物同时从 3098.5 KB 瘦到 2756.1 KB，因为少打了一整份核心）。
看门狗：浏览器测试 `python is syntax highlighted`（断言 `.cm-content span` > 0）。

**坑 B：编辑器宿主节点不能只在 `ready` 分支渲染。**
挂载写在"读到文件之后"的异步续体里：先 `setDoc(ready)` 再建视图。如果宿主 `<div>` 只在 `ready` 分支存在，React 还没提交这次渲染时 `hostRef.current === null`，于是 `if (host === null) return` —— **静默不挂载、无报错**，但状态栏正常显示文件名和行数（走 `doc.text` 兜底），最容易误判成"CSS 没生效"。
修法：宿主常渲染，加载/错误状态用绝对定位覆盖在上面。

**坑 C：`.cm-editor` 铺满整块，角落点击其实在编辑器内部。**
所以"点编辑器外面就保存"在代码视图里不能靠 `page.mouse.click(4,4)`；真实使用中承担这一职责的是 `EditorView.domEventHandlers({ blur })`（点击状态栏、点聊天框、Tab 出去都会触发）。两处都要有：外部 `pointerdown/keydown` 捕获 + 视图 `blur`。

### 8.4 保存语义（与富文本逐条对齐）

- **无定时器**：旧 `dsh-sidebar-editor` 的代码编辑器是 900 ms 自动写回，这里刻意去掉。同一文件两种写盘节奏 = 两种冲突窗口 + 两种"我改完没落盘"的错觉。
- **无草稿**：`localStorage` 那份也删了。
- 保存点：`Ctrl/Cmd+S`、视图失焦、编辑器外任意 `pointerdown`/`keydown`、`visibilitychange=hidden`、`pagehide`、**卸载前**。
- **"卸载前"这一条在富文本里曾是死代码（独立复核抓到的）**：Milkdown 原先在 cleanup 里 `void saveDocument(false)`，而 `save` 把活排进微任务、`runSave` 又要先读 `editorRef.current` —— cleanup 的同步段却已经把 `editorRef` 置空并 `destroy()` 了，于是这次写 **100% 不会发生**（0.2.x 起就这样，当时没有"程序化换视图"这条路径去暴露）。
  修法：cleanup **同步** `flushPendingInput` + `readMarkdown` 取 body，作为参数交给队列（`runSave(force, { body })`），不再回头读视图。测试 `switching views flushes the unsaved rich text buffer` 是看门狗（不留任何手势，只靠卸载）。
- 串行化：一个手势会同时触发两三个保存点（点外面 = pointerdown + blur），队列串起来，后一个发现"没有可写内容"直接返回。
- 冲突自愈：`conflict` 但磁盘字节与要写的一模一样 → 视为成功（就是"上次其实写进去了"）。
- 保存成功后按"缓冲区是否仍等于写入内容"决定状态栏（否则边写边打字会把新改动标成"已保存"，`beforeunload` 也就不再警告）。
- 外部修改的横幅必须给得出三个出口（覆盖磁盘 / 重新加载 / 保留我的修改）。代码视图第一版只给了"覆盖磁盘"且横幅消不掉，复核第 4 条，已补。

### 8.5 先写后读：客户端共享队列 + 宿主 FIFO

切换视图 = 一个 body 卸载、另一个挂载，全在同一个提交里。旧 body 的最后一笔写和 new body 的第一次读从**同一个任务**发出，走**两条 HTTP 连接**；宿主能把"已到达的请求"串起来，但**改变不了发出的先后**（复核第 10 条）。

两层：

1. `src/client/write-queue.js`（**关键的一层**）：按地址的模块级队列，两个 body 共用（同一个 bundle 才有这个便利）。所有写进队列；所有读在 `call('open')` 之前 `await whenIdle(address)`。于是"卸载那一笔"一定排在新视图的读之前。
2. 宿主 `serialisedByAddress`（第二道）：同一地址的 `open`/`save` 在宿主侧也不交错。

都按地址分键，不同文件互不阻塞。`saveFile` 冲突时内部直接调 `openFile`，不再进队列 —— 否则自己等自己。

### 8.6 体积

| | 大小 |
|---|---|
| 0.2.2（只有 Milkdown） | 1071.8 KB |
| 0.3.0 第一版（核心重复） | 3098.5 KB |
| 0.3.0 定稿（单副本） | **2756.1 KB** |

要再瘦：删 `languages.js` 里不用的语法条目（php/rust/go/java/cpp/sql/xml/lua/ruby/perl/swift/scala/dart ≈ 350–450 KB）。**别动 `pnpm.overrides`**。

### 8.7 测试增量（107 → 150）

注册面（三个条目、顺序、档位、后缀不重叠、两个标题、**上报的三种排序**）、代码视图挂载/行号/高亮/可编辑、
打字不落盘、`Ctrl+S` 落盘、点外面落盘、工作区外只读且无保存按钮、冲突横幅 + 覆盖磁盘、
外部修改不动缓冲区且横幅有三个出口、markdown 围栏内也上色、
**切视图读到刚保存的内容**、**无手势卸载时富文本缓冲区被写盘**（8.4 的死代码回归测试）。

---

## 九、1.0.1：DSH 0.2.1-rc.3 兼容 + 写边界归属纠正

### 9.1 现象

用户把 DSH 从 0.2.1-rc.2 升到 **rc.3**（2026-10-23 装完），随后报"插件失效"，补充说明是"**有些可以，但这个不行**"：
同一个会话里，工作区内的 `.md` 一切正常（截图里富文本视图照常渲染、表格正常、底部"已保存"），
但 `D:\Coding_Plan\商务报价agent\…\报价书_设计费_20261024重算版.md` 这个文件打不开/不能编辑。

### 9.2 定位过程（值得复用）

1. **宿主日志**：`%TEMP%\dsh-sidebar-editor-host.log` 里有 `module loaded (v1.0.0 …)` + 6 条路由注册 → 插件本体是加载的。
2. **客户端上报**：`%TEMP%\dsh-sidebar-editor-report.json` 是当场写的，`probe.md` 排序仍是
   `[富文本, 源码, 官方 Markdown, 官方代码]` → 注册面没被 rc.3 破坏。
3. **rc.3 的契约没变**：从 `app.asar` 里抽出 `dsh-client-ui-sidebar-documentpreview@0.2.1-rc.3`，
   `resourceAddress`/`scrollportRef`/`loading:"renderer"`/`rendererId`/`sidebar.right.tab.document` 的出现次数与 rc.2 **逐个相同**
   （新东西是 `client.frontmatter-fields.js` 与拆出去的 excel/pdf chunk，与我们无关）。
4. **不是内容问题**：把这个文件的正文喂进 `tests/harness/app.jsx` 用真 Chromium 渲染 →
   72 个块、2 张表、零报错。所以失败与 Markdown 内容无关。
5. **工作区对不上**：会话 `session-4b802e62…` 的 `cwd` 是
   `D:\ProjOutline\恩平市恩城街道老旧小区（河北）综合改造项目`（见 `session.v4.jsonl.zstd` 与 `storages\session_projcache`），
   而那个文件在 `D:\Coding_Plan\商务报价agent\…` —— **在工作区之外**。
6. **策略对不上**：同一份 session 缓存里 `permissions.sandbox = "danger-full-access"`。
   而本插件在 rc.2 时代把"写边界"写成"必须在工作区内"：`writable = fs.contains(root, target)`。
   于是在一个 **平台允许任意写** 的会话里，插件自己把文件判成只读 —— 表现就是"这个不行"。

### 9.3 修法

`resolveTarget()` 现在先取**会话的沙箱策略**，再决定 `writable`：

```
writable = fs.contains(root, target) || policy.mode === 'danger-full-access'
```

- `workspace-write`：行为不变（工作区外只读，状态栏写明原因）。
- `danger-full-access`：工作区外也能编辑，写的时候照旧把同一个 policy 传给 `fs.writeText`，由后端最终裁决。
- 没有工作区根、只有绝对路径的那种地址，同样按上面规则给 `writable`（以前是恒 `false`）。

顺带纠正了措辞：`sandboxDenied` 的文案原来写"拒绝写入"，但读失败也会落到这个码上，改成"拒绝访问该文件"。

### 9.4 测试

`tests/host.mjs` 里 `sandboxPolicy` 变成可按用例切换的 `policyMode`，新增三条：
工作区外文件在 `danger-full-access` 下 `open` 可写 → `save` 真的落盘 → 切回 `workspace-write` 再写又被拒。
（27 → 31 项）

---

## 十、1.1.0：可选的全盘可写模式

用户问"能不能不写沙箱、当全盘浏览器用"。技术上可以，但**不能让插件自己决定**，所以做成了显式开关。

### 10.1 为什么默认不开

`dsh-fs-sandbox` 的写路径是：`policy = 传入的 policy ?? ctx.sandboxPolicy.resolve()`；
`danger-full-access` 直接放行，`read-only` 直接拒，`workspace-write` 查工作区根。
也就是说"想全盘写"只有一条合法的路：**自己声明 `danger-full-access`**。插件有这个能力（它跑在主进程、有用户权限），
但默认替用户扩大权限是错的——用户以为自己在 `workspace-write` 里，插件却绕过它，那沙箱就形同虚设。

所以：`fileAccess: 'session'`（默认，跟随会话策略）/ `'full'`（显式全盘）。

### 10.2 实现

- `src/index.js`：模块级 `fileAccessMode`；`apply(ctx, config)` 从插件行 config 读 `fileAccess`；
  `sandboxPolicyFor()` 在 `'full'` 时直接返回 `{ mode: 'danger-full-access' }`。其余逻辑零改动：
  `resolveTarget` 的 `writable`、`openFile` 的 `allowsWrite`、`saveFile` 传给 `fs.writeText` 的策略，全都走这同一个函数。
- 启动日志带 `fileAccess=…`，配置有没有被读到一眼可见。
- 启用方式（profile 的 `cordis.patch.yml`）：

```yaml
- id: sidebar-editor
  name: dsh-sidebar-editor
  config:
    fileAccess: full
```

### 10.3 测试

`tests/host.mjs` 末尾新增一组（31 → 34 项）：以 `{ fileAccess: 'full' }` 重新 `apply`，
在 `workspace-write` 会话下打开工作区外文件 → `writable === true`、`sandbox.mode === 'danger-full-access'`、`save` 真的落盘。
默认模式的那几条断言在前面，不受影响。

---

## 十一、1.2.0：右键菜单里的"关闭全部/其他标签"

### 11.1 需求与探针结论

用户要"关闭侧边栏的所有标签"。探针（DSH 0.2.1-rc.3）结论：

| 问题 | 结论 |
|---|---|
| 官方有批量关闭吗 | **没有**。`ISidebarRight` 只有 `close(tabId)`；dockkit 的 `TabMenu` 只画自家「关闭」一项；语言包只有 `dock.closeTab` |
| 有扩展点吗 | 有：`sidebar.right.tab.menu.item`，session 作用域 list 槽，`TabMenu` 把它当 `extras` 画在「关闭」之后，props 是 `{ tab, dismiss }`。全 app 扫描：**此前没有任何内置插件注册进去** |
| 怎么编程式关闭 | `ctx.sidebarRight`（`reflect.provide("sidebarRight", controller)`）：`mounted`（当前会话 snapshot）、`tabsIn(sessionId)`（该会话的 TabRecord[]）、`openTabs`（跨会话公开清单）、`close(tabId)` |
| 样式怎么对 | dockkit 的 `.menuItem` 在自己的 CSS module 里（插件 import 不到），按 `dockkit.module.css` 抄：`padding 4px 7px`、字号 `calc(var(--dsh-content-font-size-secondary,13px) - 1px)`、圆角 `--dsw-radius-md`、hover `--dsw-alias-interactive-bg-hover` |
| 菜单显示条件 | dockkit 的菜单**没有 menuitem 就不显示**，所以补的两行必须是真 `<button role="menuitem">` |

### 11.2 实现

`src/client/CloseTabItems.jsx`：渲染两行（关闭其他 / 关闭全部），数据来自服务：

- 会话 id：`sidebarRight.mounted.getSnapshot()`；
- 标签列表：优先 `tabsIn(sessionId)`，形状不符时退回公开的 `openTabs.getSnapshot()` 并按 `sessionId` 过滤；
- 关闭：先 `dismiss()` 再逐个 `close(id)`（行和菜单一起卸载，避免在已卸载节点上 setState）；每个 close 包 try/catch。
- 只有 <2 个标签时返回 `null`（没得批量关，单个用官方那项）。
- 服务**延迟读取**（`getSidebarRight`）：它属于另一个插件，丢了只该退化成"没有这两行"，不该把本插件的注册一起停掉。

`src/client/index.js`：`ctx.slots.inject('sidebar.right.tab.menu.item', …)` 注册，id `dsh-sidebar-editor-close-tabs`，`locale: NS`（槽运行时因此注入 `t`）。文案 `closeAllTabs` / `closeOtherTabs` 进中英字典。

`src/client/theme.js`：`.dsh-se-tab-menu-item` 及 hover/active，复刻 dockkit 的行样式。

### 11.3 行为细节（官方规则，不是我们的选择）

- 关掉会话的最后一个标签会让右侧栏**整列收起**（文档：显式关闭最后一个 tab 会连同整列一起收起，布局留空，下次展开播种默认页）；
- 引导页作为唯一停靠标签时不可关闭（我们的循环对它 no-op）；
- 浮窗里的标签同样计入并一起关闭；
- 布局持久化在 `dsh.sidebar-right.v1.<sessionId>`，所以关完重启还是空的。

### 11.4 测试

- 测试基建：harness 的 `slots.register` 改成按 `${slot}::${key|id}` 存组件（keyed 正文和 list 项共用一张表）；新增假 `ctx.sidebarRight`（`mounted`/`tabsIn`/`openTabs`/`close`）与 `mountListItem` 辅助；list 项渲染时补 `t`（真槽运行时会注入）。
- 新增 7 条（150 → 157）：槽里有注册、两行文案、role=menuitem、点"关闭其他"不误关右键那个、菜单自行 dismiss、点"关闭全部"关全部、只有一个标签时不出这两行。
- 宿主半/打包契约不变（34 + 11）。

---

## 十二、1.2.1：动态客户端插件的"服务属性访问"要 inject 放行

### 12.1 现场

1.2.0 发出去、用户重启 DSH 后，右键标签**仍然只有官方「关闭」**——菜单出来了，我们的两行被吞掉。

### 12.2 根因

动态加载的客户端插件（profile 里的第三方包都走这条路）拿到的 `ctx` 不是原始 fiber ctx，而是
`dsh-cordis-client-runner` 里的白名单门面 `dynamicCordisContext`。它自己的注释写着：

> Build the facade one dynamic plugin's `apply` receives (host sandboxContext twin, browser seats).
> **`ctx.get(name)` performs optional lookup; direct `ctx.serviceName` access is gated by the fiber's `inject` declaration.**

1.2.0 写的是 `ctx.sidebarRight ?? ctx.get('sidebarRight')`——属性优先。属性访问被门面拦下（拿不到），
于是 `sidebarRight === undefined`，组件直接 `return null`。而 dockkit 的菜单只要
`onClose !== undefined` 就会显示，所以症状正是"菜单在、两行没了"。

### 12.3 修法

```js
// 先 ctx.get（可选查找，门面允许），属性访问退成兜底并 try/catch
const readSidebarRight = () => {
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get('sidebarRight');
      if (viaGet !== undefined && viaGet !== null) return viaGet;
    }
  } catch { /* gated */ }
  try { return ctx.sidebarRight; } catch { return undefined; }
};
```

**没有**改 plugin 级 `inject: ['sidebarRight']`：那会让"右侧栏被禁用"顺带停掉整个编辑器，
代价远大于收益。`ctx.get` 的可选语义正好是我们要的。

### 12.4 诊断（这次加了，以后留着）

菜单项每次渲染都会往 `%TEMP%\dsh-sidebar-editor-host.log` 写一行（最多 8 行）：

- `{"kind":"tab-menu","stage":"slot-ready"}` —— 槽注入成功；
- `{"kind":"tab-menu","stage":"render","rendered":2,"tabs":4}` —— 正常渲染两行；
- `{"kind":"tab-menu","stage":"render","skipped":"no-service"}` / `"too-few-tabs"` —— 没渲染及原因。

真机验证：`slot-ready` 一次 → `render rendered:2 tabs:4 / 3 / 2` 三行，与用户操作一致。

### 12.5 测试

宿主半 34 + 打包契约 11 + 行为 157，全绿（本次是取服务方式与诊断，行为断言不变）。
