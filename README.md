# dsh-sidebar-editor

给 **DSH 桌面版**侧边栏的文档预览加两个**可编辑**视图：Markdown 走 ProseMirror（Milkdown）的渲染式编辑，代码与纯文本走 CodeMirror 6。两个视图共用一套读写通道和同一套保存语义。

**版本 1.0.0** · 状态、决策与已知边界见 [docs/STATE.md](docs/STATE.md)

## 名字与来历

这个仓库以前叫 `dsh-sidebar-milkdown`（0.1.0–0.3.0），从一个只管 Markdown 的 ProseMirror 编辑器长成了"富文本 + 源码"双视图的编辑器，所以在 1.0.0 改成现在的名字。

更早还有一版 `dsh-sidebar-editor`（1.0.x），做法是把每个块画成 React 组件、再让浏览器 `contenteditable` 直接编辑渲染结果。那条路线被淘汰了：写回时静默吞块、tile 崩溃白屏、选区不跨块，这些都是那套"三个主人管一片 DOM"的结构性后果。**它的仓库已经删除**，名字由这一版接手；想对照历史只能看本地 `_backup` 里的 git bundle。

| | 旧路线（已退役） | 现在这一版 |
|---|---|---|
| 文档模型 | CodeMirror 6 的字符串 + 每块一个 React 渲染 + 浏览器 `contenteditable` | **ProseMirror 的一个文档模型 + 一个视图** |
| 同一片 DOM 的主人 | 三个（CM 的偏移、React 树、浏览器光标/输入法） | 一个 |
| 换行 | 插件自己切 DOM | 编辑器自己的 `splitBlock`，光标不移动 |
| 跨段落选区 | 不支持 | **原生支持** |
| Markdown 读写 | 自己写的 HTML→Markdown 序列化 | remark（`remark-parse`/`remark-stringify`，GFM 由 `remark-gfm`） |
| 代码文件 | 只有只读的官方「代码」视图，或旧插件的 CodeMirror | **可编辑 CodeMirror 视图**（本插件第三/四个注册条目） |

## 它做什么

在官方侧栏文档预览的**视图下拉**里注册**三个**实现（同一个插件、同一套读写通道、两个视图）：

| 项 | 富文本视图 | 代码视图（可编辑） | 代码视图（不抢默认） |
|---|---|---|---|
| 实现 id | `dsh-sidebar-editor` | `dsh-sidebar-editor-code` | `dsh-sidebar-editor-code-shipped` |
| 认领后缀 | `.md` `.markdown` | 官方代码表 115 个后缀中除下栏的（含 `.md`） | `.html` `.htm` `.svg` `.csv` |
| 优先级 | `'preferred'` | `'preferred'` | `'builtin'`（和官方同档，靠官方先注册所以官方仍是默认） |
| 何时是默认 | `.md`（同档同长度靠注册顺序排第一） | `.py` `.js` `.json` `.yaml` 等源码文件（压过官方只读「代码」视图） | 不抢：官方 HTML 预览 / 图片 / 表格视图保持默认 |
| 加载模式 | `'renderer'` | 同左 | 同左 |
| 渲染体 | `src/client/MilkdownBody.jsx` | `SourceBody.jsx` | `SourceBody.jsx`（同一个组件，另一个 slot key） |

`candidates` 的顺序因此是：`.md` = **富文本 → 源码 → 官方 Markdown**；`.py` = **源码 → 官方代码**；`.html/.svg/.csv` = **官方渲染 → 源码**。
用户点下拉换视图后，`rendererId` 按标签页记住；新标签页回到默认。

> 为什么不把 `.html/.svg/.csv` 也放第一栏：一个实现只有一个优先级档，而"让源码成为默认"和"把图片当文本打开"是两件事。`.svg` 打成文本、`.csv` 打成文本都不是"编辑代码"，是丢掉了本来能用的渲染视图。要改成"全部抢默认"，把 `PRODUCT_RENDERED_EXTENSIONS` 挪进 `SOURCE_EXTENSIONS` 即可（一行）。

| 时机 | 行为 |
|---|---|
| 打开 | POST `/api/dsh-sidebar-editor/open` 拿正文 + `version`（新鲜的版本号） |
| 编辑 | ProseMirror 事务，不碰文件 |
| **停下不保存** | **没有"停手 N 毫秒自动保存"**——定时器会在你打中文打到一半时动手，是输入法被打断的根源 |
| `Ctrl/Cmd+S` | 立即写回（带 `baseVersion` 版本校验） |
| 焦点离开编辑器 | 立刻写回（离开文档就算"我改完了"） |
| 在编辑器外按任意键 / 点任意处 | 立刻写回（点聊天框、切对话、按回车发消息都算） |
| 页面隐藏 / 卸载（`visibilitychange` / `pagehide`） | 立刻写回；还有未保存内容时关窗口会先弹确认 |
| 视图销毁 / 换文件 | 先把没写的内容写掉，再销毁 |
| 磁盘被别人改了 | 缓冲区**不动**，顶部横幅给「载入磁盘版本 / 保留我的修改」 |
| 另一个会话保存了同一文件（`revision` 变化） | 就地合并：内容没变只换版本号；内容变了且你没改过→原地替换（**不重建编辑器**）；你改过→只提示 |
| 工作区外的文件 | 看会话的沙箱策略：`danger-full-access` 下**可编辑**；`workspace-write` / `read-only` 下只读打开（`contenteditable="false"`，状态栏写明原因） |

两张保护网值得单独说：

- **不重建编辑器**：`revision` 变化时绝不销毁重建视图。销毁会丢焦点、掐断输入法组合，表现就是"一保存就被踢出编辑状态"。
- **组合期间不动 React**：中文输入法组词时（`view.composing`），状态栏、表格按钮都不更新——任何同级 DOM 变动都可能让候选词消失、把拼音当英文提交。

**打开不写盘**：底稿取「刚解析完的文档再序列化一次」的结果，而不是文件原文。Milkdown 的往返会规范化列表符号、表格补空格等，拿规范化结果当底稿，才做到"只是看一眼不会改文件"。

## 表格

`prosemirror-tables` 只有命令、没有界面，所以这个插件补了两个小按钮：

- 光标进入表格（或鼠标悬停表格）时，表格右上角出现「＋ 行 / ＋ 列」；
- 点它们不会把光标抢走（`mousedown` 被拦下）；
- 在单元格里按 `Tab` 走到最后一格再按 `Tab` 也会加一行（`goToNextCell` 的既有行为）；
- 表格末尾回车会退出表格，这是刻意保留的行为。

## 字体跟随 DSH 设置

排版不是硬编码字号，而是照抄官方预览的 Markdown 样式表：`--dsw-font-markdown-base` / `-h1..h4` / `-table` / `-code` / `--ds-font-family-code`。
主题服务在用户改字号/字体设置时会重算这些令牌，所以官方预览和这个编辑器会一起变。

## 代码视图（CodeMirror 6）

`src/client/codemirror/` 这一块从已退役的旧插件搬来，只保留纯文本编辑器部分：

| 文件 | 作用 |
|---|---|
| `languages.js` | 后缀 → 语法（25 个语法 + legacy mode），markdown 代码块按 info string 上色 |
| `claims.js` | 认领的后缀表，抄官方 `CODE_HIGHLIGHT_EXTENSIONS`，一后缀不差 |
| `theme.js` | 外观绑定 DSH 令牌：`--ds-font-family-code`、`--shiki-token-*`（和聊天里渲染的代码块同色） |
| `SourceBody.jsx` | 行号 / 折叠 / 括号匹配 / 搜索 / 缩进、读写、冲突、状态栏 |

**没有搬**：`blockWidget.js`、`markdownPreview.js`、`markdownSerialize.js`、`officialMarkdown.js`、`annotations.js`。那是"渲染块 + contenteditable"那条路线，也就是旧插件被淘汰的原因（写回吞块、tile 崩溃、跨块选区）。

保存语义与富文本视图**完全一致**（无定时器、无草稿）：`Ctrl/Cmd+S`、失焦、在编辑器外点击/按键、页面隐藏、卸载、切视图前。冲突与"磁盘被外部修改"的横幅也一样。

> ⚠️ **语法表必须静态 import，且 CodeMirror 核心只能有一份**。插件产物是单个 classic script，没有 dynamic-import 钩子，所以不能用 `@codemirror/language-data` 的懒加载；另外 `@codemirror/language` / `@codemirror/view` 若出现两份副本，`language` facet 与高亮插件的身份不同，**语法高亮会静默失效**（文字正常、颜色全无、无报错）。`package.json` 里的 `pnpm.overrides` 就是钉死这一份的，别删。测试 `python is syntax highlighted` 是这条的看门狗。

## 宿主半（host）

`src/index.js` 是宿主半，注册 `/api/dsh-sidebar-editor/{ping,probe,open,save,report,diag}`。
读写走官方文件服务 `ctx.fs.writeText(target, text, { kind: 'replaceIfVersion', version })`，因此：

- 版本冲突是 `FS_STALE_VERSION`，不会静默覆盖别人的修改；
- 沙箱策略（`ctx.sandboxPolicy`）随会话解析：`read-only` 全拒；`workspace-write` 只写工作区内；`danger-full-access` 不限制（详见下一节）；
- 记账文件：`%TEMP%\dsh-sidebar-editor-host.log`（加载与失败痕迹）、`%TEMP%\dsh-sidebar-editor-report.json`（浏览器半上报的排序结果）。

**先写后读有两层**：客户端 `src/client/write-queue.js` 按地址排队（写完才允许读，读之前 `await whenIdle`），宿主半 `serialisedByAddress` 再兜一层。切换视图时"旧视图的最后一笔写"一定排在新视图的读之前——只有"一个插件、一个 bundle、一个宿主半"才做得到这件事。

## 全盘可写模式（可选，`fileAccess: 'full'`）

默认情况下编辑器跟随**会话的沙箱策略**：`workspace-write` 会话只能改工作区内的文件（工作区外只读），`danger-full-access` 会话可以改任意位置。

如果你想让这个编辑器当成"全盘文件浏览器"用、不理会会话策略，在 profile 的 `cordis.patch.yml` 里给插件行加一行配置即可：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: sidebar-editor
  name: dsh-sidebar-editor
  config:
    fileAccess: full
```

改完**完全退出并重开 DSH**。生效后：

- 打开任何位置的文本文件都是**可编辑**的，保存直接落盘（插件会向 `fs.writeText` 自己声明 `danger-full-access` 策略）；
- 宿主日志会打印 `apply: … fileAccess=full`，可用来确认配置真的被读到了；
- 想回退就把这段删掉（或写 `fileAccess: session`），默认值就是跟随会话策略。

> 为什么默认不开：插件不应该偷偷扩大自己的权限。`danger-full-access` 是"用户明确说了算"的档位，所以它必须由用户在配置里显式打开，而不是插件替用户决定。

## 开发

```powershell
pnpm install
pnpm build          # esbuild → lib/client.js（单文件，经典脚本 + __ModuleLoader__ 包装）
pnpm test           # 宿主半 + 打包契约 + 行为（后两段都在真实 Chromium 里跑）
```

`pnpm test` 三段：

| 文件 | 覆盖 |
|---|---|
| `tests/host.mjs` | 宿主半：`apply()` 真注册 6 条路由、`open`/`save` 的读写、版本冲突、工作区外只读、CRLF 与 BOM 往返 |
| `tests/artifact.mjs` | 打包契约：按真实方式加载 `lib/client.js`，检查 id / 工厂 / 导出面 / `inject` / 两半 `/api` 前缀一致 |
| `tests/browser.mjs` | 行为：渲染、样式落地、跨块拖选、四种回车、自动保存写出的 Markdown、frontmatter 往返、只读、**代码视图**（挂载/高亮/行号/Ctrl+S/失焦与点外面保存/只读/冲突横幅/外部修改/切视图读到刚保存的内容） |

jsdom 回答不了"点击能不能落光标、选区能不能跨块、回车到底插了什么、写回的 Markdown 长什么样"。

改了 `package.json` 的依赖后必须 `pnpm install`（`pnpm.overrides` 只在安装时生效），再 `pnpm build`。

## 安装到一个 profile

```jsonc
// ~/.dsh/profiles/desktop/package.json
"dependencies": { "dsh-sidebar-editor": "link:D:/Coding_Plan/DSH_Plugin_insNdev/dsh-sidebar-editor" },
"dsh": { "profile": { "bundles": [ /* … */ "dsh-sidebar-editor" ] } }
```

```powershell
cd ~/.dsh/profiles/desktop; pnpm install
```

然后**重启 DSH**（宿主半是新增行，必须重启）；只改客户端时 `Ctrl+Shift+R` 即可。

## 关闭侧栏标签（右键菜单）

右侧栏把每个打开的文件/页面画成一个 dock 标签。产品本身只提供「关闭这一个」（标签胶囊上的 ×，或右键菜单里的「关闭」），没有批量关闭。本插件在**标签的右键菜单**里补两行：

| 菜单项 | 行为 |
|---|---|
| 关闭其他标签 | 关掉当前会话里除右键这个标签之外的所有标签 |
| 关闭全部标签 | 关掉当前会话里所有标签 |

- 作用域是**当前会话**：别的会话里的标签不动。
- 走的是官方 `ctx.sidebarRight.close(tabId)`，和点 × 完全同一条路径，所以官方规则照旧生效：**关到最后一个标签时右侧栏会收起**（下次展开重新播种默认页）；引导页作为唯一停靠标签时不会被关掉。
- 浮窗里的标签也一起关。
- 只有一个标签时这两行不出现（没得批量关）。
- 关掉的布局是持久化的，重启后仍然是关着的。

实现只有客户端：`src/client/CloseTabItems.jsx` + 注册到 `sidebar.right.tab.menu.item`（session 作用域的 list 槽，dockkit 的 `TabMenu` 把它的内容画在自家「关闭」之后）。宿主半没有改动，所以**硬刷新即可，不用重启 DSH**。


## 已知边界（1.2.0）

- **空段落不保留**：Milkdown 默认把空段落写成 `<br />`，而官方预览不渲染裸 HTML，重开就会看到字面 `<br />`。本插件移除了那个插件，所以空行在保存后消失（空段落没有 Markdown 表示）。
- **软换行合并**：一段里用软换行折行的两行，解析成一个段落的两行文本；保存后合成一行。这是 Markdown 的本来语义。
- **表格单元格内不换行**（旧版也一样）；表格只提供＋行/＋列，没有删除行/列——`prosemirror-tables` 有命令但没有自带右键菜单，做一个会误删的按钮不值得。
- **注释/选区批注**：`dsh-quote-annotate-pro` 的划词气泡在本编辑器里不弹，原因在批注插件里——它把落在任何 `contenteditable` 里的选区都当作"在输入框里打字"而隐藏。查证与两行改法见 [docs/STATE.md](docs/STATE.md) 第五节。**代码视图里不要指望它**（CodeMirror 的编辑面同样是 `contenteditable`）。
- **源码视图不是"无损"的替代品**：它是逃生门。富文本序列化会规范化列表符号、表格对齐、空行，想逐字节保住原样就只能用源码视图改完再保存。
- **没有跨块/整篇的注释**，也没有删除表格行列的按钮。
- **代码视图只读范围**：沙箱 `read-only`、`workspace-write` 下工作区外的文件、超过 2 MB 的文件都会被拒绝写（状态栏写明原因）。写边界跟随**会话的沙箱策略**：`danger-full-access` 会话不受工作区限制。
- **产物体积 2.75 MB**：Milkdown + CodeMirror + 25 个语法全在同一个 classic script 里（无代码分割）。要瘦就删 `languages.js` 里不用的语法条目，别动 `pnpm.overrides`。
