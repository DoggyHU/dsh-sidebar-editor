# dsh-sidebar-milkdown

给 **DSH 桌面版**侧边栏文档预览增加一个 **ProseMirror（Milkdown）渲染式 Markdown 编辑器**的新插件。

它不是旧插件 `dsh-sidebar-editor` 的补丁，而是**换掉底层思路**的另一条路线：

| | 旧路线 `dsh-sidebar-editor` | 新路线 `dsh-sidebar-milkdown` |
|---|---|---|
| 文档模型 | CodeMirror 6 的字符串 + 每块一个 React 渲染 + 浏览器 `contenteditable` | **ProseMirror 的一个文档模型 + 一个视图** |
| 同一片 DOM 的主人 | 三个（CM 的偏移、React 树、浏览器光标/输入法） | 一个 |
| 换行 | 插件自己切 DOM（v1.0.11 的块内分段） | 编辑器自己的 `splitBlock`，光标不移动 |
| 跨段落选区 | 不支持（用户已接受） | **原生支持** |
| Markdown 读写 | 自己写的 HTML→Markdown 序列化 | remark（`remark-parse`/`remark-stringify`，GFM 由 `remark-gfm`） |

**版本 0.1.0** · 状态、决策与已知边界见 [docs/STATE.md](docs/STATE.md)

## 它做什么

在官方侧栏文档预览的**视图下拉**里注册一个实现：

| 项 | 值 |
|---|---|
| 实现 id | `dsh-sidebar-milkdown` |
| 认领后缀 | `.md` `.markdown` |
| 优先级 | `'preferred'` —— 排序在官方 `builtin` 之前，所以它是 `.md` 的**默认视图** |
| 加载模式 | `'renderer'`（渲染体自己负责读写与版本号，和官方 Office 视图同一个模式） |

渲染体是 `src/client/MilkdownBody.jsx`：

| 时机 | 行为 |
|---|---|
| 打开 | POST `/api/dsh-sidebar-milkdown/open` 拿正文 + `version`（新鲜的版本号） |
| 编辑 | ProseMirror 事务，不碰文件 |
| **停下不保存** | **没有"停手 N 毫秒自动保存"**——定时器会在你打中文打到一半时动手，是输入法被打断的根源 |
| `Ctrl/Cmd+S` | 立即写回（带 `baseVersion` 版本校验） |
| 焦点离开编辑器 | 立刻写回（离开文档就算"我改完了"） |
| 在编辑器外按任意键 / 点任意处 | 立刻写回（点聊天框、切对话、按回车发消息都算） |
| 页面隐藏 / 卸载（`visibilitychange` / `pagehide`） | 立刻写回；还有未保存内容时关窗口会先弹确认 |
| 视图销毁 / 换文件 | 先把没写的内容写掉，再销毁 |
| 磁盘被别人改了 | 缓冲区**不动**，顶部横幅给「载入磁盘版本 / 保留我的修改」 |
| 另一个会话保存了同一文件（`revision` 变化） | 就地合并：内容没变只换版本号；内容变了且你没改过→原地替换（**不重建编辑器**）；你改过→只提示 |
| 工作区外的文件 | 只读打开（`contenteditable="false"`） |

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

## 宿主半（host）

`src/index.js` 是宿主半，注册 `/api/dsh-sidebar-milkdown/{ping,probe,open,save,report,diag}`。
读写走官方文件服务 `ctx.fs.writeText(target, text, { kind: 'replaceIfVersion', version })`，因此：

- 版本冲突是 `FS_STALE_VERSION`，不会静默覆盖别人的修改；
- 沙箱策略（`ctx.sandboxPolicy`）随会话解析，`read-only` / 工作区外会被拒；
- 记账文件：`%TEMP%\dsh-sidebar-milkdown-host.log`（加载与失败痕迹）、`%TEMP%\dsh-sidebar-milkdown-report.json`（浏览器半上报的排序结果）。

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
| `tests/browser.mjs` | 行为：渲染、样式落地、跨块拖选、四种回车、自动保存写出的 Markdown、frontmatter 往返、只读 |

jsdom 回答不了"点击能不能落光标、选区能不能跨块、回车到底插了什么、写回的 Markdown 长什么样"。

## 安装到一个 profile

```jsonc
// ~/.dsh/profiles/desktop/package.json
"dependencies": { "dsh-sidebar-milkdown": "link:D:/Coding_Plan/DSH_Plugin_insNdev/dsh-sidebar-milkdown" },
"dsh": { "profile": { "bundles": [ /* … */ "dsh-sidebar-milkdown" ] } }
```

```powershell
cd ~/.dsh/profiles/desktop; pnpm install
```

然后**重启 DSH**（宿主半是新增行，必须重启）；只改客户端时 `Ctrl+Shift+R` 即可。

## 已知边界（0.2.0）

- **空段落不保留**：Milkdown 默认把空段落写成 `<br />`，而官方预览不渲染裸 HTML，重开就会看到字面 `<br />`。本插件移除了那个插件，所以空行在保存后消失（空段落没有 Markdown 表示）。
- **软换行合并**：一段里用软换行折行的两行，解析成一个段落的两行文本；保存后合成一行。这是 Markdown 的本来语义。
- **表格单元格内不换行**（旧版也一样）；表格只提供＋行/＋列，没有删除行/列——`prosemirror-tables` 有命令但没有自带右键菜单，做一个会误删的按钮不值得。
- **注释/选区批注**：`dsh-quote-annotate-pro` 的划词气泡在本编辑器里不弹，原因在批注插件里——它把落在任何 `contenteditable` 里的选区都当作"在输入框里打字"而隐藏。查证与两行改法见 [docs/STATE.md](docs/STATE.md) 第五节。
- **代码编辑器**：旧插件对 115 种代码后缀的 CodeMirror 编辑器不在本插件范围内；停用旧插件后，代码文件回落到官方「代码」视图。
