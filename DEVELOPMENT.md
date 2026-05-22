# Y-Nav 开发维护文档

> 本文档面向后续维护本仓库的开发者 / AI 助手。
> 目标：在不重复扫描全仓的前提下，快速定位**架构 / 功能模块 / 路由 / API**。
> 与最终用户文档区分：用户向请看根目录的 `README.md`。

---

## 1. 技术栈速览

| 层级       | 技术 / 库                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 前端框架   | React 19 + TypeScript 5.8 + Vite 6                                                                                           |
| 路由       | 纯前端手写路由（`src/main.tsx`，无第三方 router 库）                                                                         |
| 样式       | Tailwind CSS v4（`@tailwindcss/vite` 插件）                                                                                  |
| 图标       | `lucide-react`                                                                                                               |
| 拖拽       | `@dnd-kit/core` / `sortable` / `utilities`                                                                                   |
| 代码高亮   | `shiki`（VS Code 同款 TextMate 引擎，JS Regex 实现免 WASM，按语言/主题动态 import），`@monaco-editor/react` 用于编辑         |
| 虚拟列表   | `@tanstack/react-virtual`                                                                                                    |
| AI         | `@google/genai`（首次调用时动态 import）                                                                                     |
| 字体       | `@fontsource/manrope`                                                                                                        |
| 后端运行时 | Cloudflare Workers（主入口 `worker/index.ts`） + Cloudflare Pages Functions（旧入口 `functions/api/sync.ts`，二选一即可）    |
| 静态资源   | Workers Sites（`[site] bucket = "./dist"`，配合 `@cloudflare/kv-asset-handler`）                                             |
| 持久化     | Cloudflare KV（导航数据 / 备份） + Cloudflare D1（私有脚本库，FTS5 trigram 全文搜索） + LocalStorage（Local-First 离线缓存） |
| 鉴权       | 主站同步：`X-Sync-Password` 头部口令；脚本库：PBKDF2-SHA256 + HMAC 签名 HttpOnly Cookie 会话                                 |
| 测试       | Vitest 4 + Testing Library + jsdom                                                                                           |
| 质量工具   | ESLint 9 (flat config) + Prettier 3 + typescript-eslint 8                                                                    |
| 部署       | GitHub Actions（`.github/workflows/deploy-workers.yml`） / Cloudflare Pages（Git 集成）                                      |

> **部署模式**：仓库**优先以 Cloudflare Workers 部署**（`wrangler.toml`），`functions/api/sync.ts` 是 Pages Functions 的备选；两者实现等价的 `/api/sync*` 接口。`/api/snippets/*` 仅在 Workers 形态下提供（依赖 D1 绑定）。

---

## 2. 顶层目录树（含忽略说明）

```
y-nav/
├── src/                       # 【核心】React 前端源码
│   ├── App.tsx                #   主页（导航仪表盘）根组件
│   ├── main.tsx               #   入口 + 前端路由分发（/, /scripts, /share/:token）
│   ├── types.ts               #   全局 TS 类型定义（LinkItem / Category / ScriptSnippet 等）
│   ├── index.css              #   全局样式 / Tailwind 入口
│   ├── components/            #   UI 组件
│   │   ├── layout/            #     页面级布局（Sidebar / Header / LinkSections / ContextMenu）
│   │   ├── modals/            #     模态框（Link / Category / Import / Settings / 同步冲突 / 搜索）
│   │   │   └── settings/      #       设置弹窗内的 Tab 子组件
│   │   ├── scripts/           #     /scripts 脚本库整套 UI + 数据 hook
│   │   └── ui/                #     通用 UI（DialogProvider / Icon / LinkCard / SyncStatusIndicator…）
│   ├── hooks/                 #   功能 hooks（数据 / 同步 / 主题 / 搜索 / 配置…）
│   ├── services/              #   外部服务客户端（Gemini / Snippet API / 导入导出 / 书签解析）
│   ├── utils/                 #   纯工具（常量 / 私有保险库加密 / icon 颜色推断）
│   └── vite-env.d.ts
│
├── worker/                    # 【核心】Cloudflare Workers 入口
│   ├── index.ts               #   主入口：静态资源 + /api/sync + 安全响应头
│   ├── snippets.ts            #   /api/snippets/* 路由、鉴权、CSRF、限流、D1 访问
│   ├── tsconfig.json          #   Worker 专属 TS 配置
│   └── types.d.ts             #   Worker 用环境/全局类型补丁
│
├── functions/                 # 【核心】Cloudflare Pages Functions（仅当走 Pages 部署时启用）
│   └── api/sync.ts            #   与 worker 中 /api/sync 等价的 Pages Function 版本
│
├── migrations/                # 【核心】D1 SQL 迁移（顺序敏感）
│   ├── 0001_create_snippets.sql
│   ├── 0002_auth_settings.sql
│   ├── 0003_login_attempts.sql
│   ├── 0004_snippets_v2.sql   #   FTS5 + 软删除 + 浏览计数 + 版本历史
│   └── 0005_snippet_share.sql #   公开分享 token / share_enabled
│
├── scripts/
│   └── hash-password.mjs      #   生成 PBKDF2 密码哈希（`npm run hash:password`）
│
├── public/
│   └── _redirects             #   Pages SPA fallback（/scripts → /index.html）
│
├── tests/                     #   Vitest 单元测试（jsdom + testing-library）
│   ├── setup.ts
│   ├── highlight-text.test.tsx
│   └── variables.test.ts
│
├── index.html                 #   Vite HTML 模板（含暗色模式 flash 防抖脚本）
├── vite.config.ts             #   Vite 构建配置（manualChunks / API_KEY define / alias @ → src）
├── vitest.config.ts           #   测试 + coverage 配置（include 列表已收敛到关键文件）
├── tsconfig.json              #   前端 TS 配置（strict + bundler 解析）
├── eslint.config.js
├── .prettierrc.json / .prettierignore
├── wrangler.toml              #   Workers 部署配置（KV / D1 绑定 / Secrets 说明）
├── package.json               #   依赖与 npm scripts
├── README.md                  #   面向终端用户的部署说明
├── CHANGELOG.md               #   版本变更记录
└── LICENSE
```

### 🚫 维护时通常可忽略的目录

| 目录 / 文件                  | 原因                                      |
| ---------------------------- | ----------------------------------------- |
| `node_modules/`              | npm 依赖产物                              |
| `dist/`                      | Vite 构建产物（`npm run build` 重新生成） |
| `.wrangler/`                 | Wrangler 本地状态/缓存                    |
| `.git/`                      | Git 元数据                                |
| `.idea/`                     | JetBrains IDE 配置                        |
| `.github/`                   | CI 工作流（仅在改 CI 时进入）             |
| `.claude/` / `.claudecoderc` | Claude Code 本地配置                      |
| `package-lock.json`          | 自动生成，体积大                          |
| `LICENSE`                    | 许可证文本                                |
| `public/`                    | 仅含一个 `_redirects` 静态文件            |
| `tests/`                     | 仅在改对应被测代码或调试用例时再读        |

> 排查 bug 时**首要关注**：`src/` + `worker/` + `migrations/` + `wrangler.toml`。

---

## 3. 前端路由（手写，集中在 `src/main.tsx`）

`src/main.tsx` 用 `window.location.pathname` + `popstate` 监听做简易路由分发，全部页面挂在同一个 SPA 中。

| 路径            | 组件                                                   | 说明                                                                    |
| --------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `/`（默认）     | `src/App.tsx`                                          | 主导航仪表盘（链接 / 分类 / 搜索 / 设置 / 同步 / 隐私分组）             |
| `/scripts`      | `src/components/scripts/ScriptsVault.tsx`（lazy）      | 私有脚本片段库（需登录 Cookie 会话）                                    |
| `/scripts/*`    | 同上                                                   | 任意子路径均落到 ScriptsVault（内部不再拆分子路由，靠状态切换视图）     |
| `/share/:token` | `src/components/scripts/PublicSnippetView.tsx`（lazy） | 公开分享只读视图（无需登录）                                            |
| 其它任意        | `App.tsx`                                              | SPA fallback，由 `public/_redirects` 和 Worker 内 `getAssetFromKV` 兜底 |

> 没有 React Router 依赖；新增页面要在 `src/main.tsx` 的 `detectRoute()` 中追加分支。

---

## 4. 后端 API 路由清单

主入口：`worker/index.ts` 的 `route()` 按前缀分发——

- `/api/snippets/*` → `worker/snippets.ts#handleSnippetsRequest`
- `/api/sync*` → `worker/index.ts#handleApiSync`
- 其它 → 静态资源 (`getAssetFromKV`)，SPA fallback 到 `/index.html`

所有响应都会经过 `applySecurityHeaders` 注入 CSP / X-Frame-Options / Referrer-Policy 等安全头。

### 4.1 `/api/sync` —— 主站导航数据同步

文件：`worker/index.ts`（也有等价 Pages Function 版本 `functions/api/sync.ts`）
鉴权：可选的 `X-Sync-Password` 请求头（与 `env.SYNC_PASSWORD` 比对；未配置则放行）
KV 命名空间：`YNAV_WORKER_KV`（Workers）/ `YNAV_KV`（Pages）

| 方法    | 路径                       | 处理函数            | 行为                                                                     |
| ------- | -------------------------- | ------------------- | ------------------------------------------------------------------------ |
| GET     | `/api/sync`                | `handleGet`         | 读取主键 `ynav:data`                                                     |
| POST    | `/api/sync`                | `handlePost`        | 写入数据；带 `expectedVersion` 时做乐观锁检测，冲突返回 409              |
| POST    | `/api/sync?action=backup`  | `handleBackup`      | 新建快照 `ynav:backup:<ISO 时间戳>`，TTL 30 天                           |
| POST    | `/api/sync?action=restore` | `handleRestore`     | 从指定 `backupKey` 恢复，并自动生成 `rollback-*` 回滚点                  |
| GET     | `/api/sync?action=backups` | `handleListBackups` | 列出所有备份及其 meta（deviceId / version / 浏览器 / 系统）              |
| OPTIONS | 任意                       | —                   | CORS 预检（`Access-Control-Allow-Origin: *`，允许 `X-Sync-Password` 头） |

KV 常量：`KV_MAIN_DATA_KEY = 'ynav:data'`，`KV_BACKUP_PREFIX = 'ynav:backup:'`，`BACKUP_TTL_SECONDS = 30 * 86400`。

### 4.2 `/api/snippets/*` —— 私有脚本库 + 公开分享

文件：`worker/snippets.ts`
依赖：D1 绑定 `SNIPPETS_DB`、`SNIPPETS_PASSWORD_HASH`、`SNIPPETS_SESSION_SECRET`
鉴权：

- **会话**：Cookie `__Host-snippets_session`（HttpOnly / Secure / SameSite=Lax / Path=/，10 分钟 TTL，剩余 < 5 分钟自动滑动续期）。旧名 `snippets_session` 仍兼容。
- **密码哈希**：PBKDF2-SHA256（200k 迭代）；旧 SHA-256 hex 登录后自动升级落库。
- **限流**：同 IP 15 分钟内失败 5 次 → 锁 15 分钟，返回 `429 + Retry-After`。
- **CSRF 双保险**：所有非 GET 请求必须带 `X-Requested-With: ynav`（前端 `src/services/snippetService.ts` 自动附加），否则 403。

| 方法   | 路径                                         | 处理函数                | 说明                                                        |
| ------ | -------------------------------------------- | ----------------------- | ----------------------------------------------------------- |
| POST   | `/api/snippets/auth/login`                   | `handleLogin`           | 校验密码 → 颁发签名会话 Cookie                              |
| POST   | `/api/snippets/auth/logout`                  | `handleLogout`          | 清除会话 Cookie                                             |
| GET    | `/api/snippets/auth/session`                 | `handleSession`         | 返回 `{ authenticated, configured, expiresAt }`             |
| GET    | `/api/snippets`                              | `handleList`            | 列表 / 全文搜索（FTS5）/ 标签 / 语言 / 收藏 / 回收站 / 排序 |
| POST   | `/api/snippets`                              | `handleCreate`          | 新建片段                                                    |
| GET    | `/api/snippets/:id`                          | `handleGetOne`          | 取单条；GET 同时累加 `view_count`                           |
| PUT    | `/api/snippets/:id`                          | `handleUpdate`          | 更新片段并写入历史版本                                      |
| DELETE | `/api/snippets/:id`                          | `handleDelete`          | 软删除（写 `deleted_at`）                                   |
| POST   | `/api/snippets/:id/restore`                  | `handleRestore`         | 从回收站还原                                                |
| DELETE | `/api/snippets/:id/permanent`                | `handlePermanentDelete` | 彻底删除（连同 FTS / revisions / 分享 token）               |
| GET    | `/api/snippets/:id/revisions`                | `handleListRevisions`   | 历史版本列表                                                |
| GET    | `/api/snippets/:id/revisions/:revId`         | `handleGetRevision`     | 取某个历史版本                                              |
| POST   | `/api/snippets/:id/revisions/:revId/restore` | `handleRestoreRevision` | 把当前内容覆盖为指定历史版本                                |
| POST   | `/api/snippets/:id/share`                    | `handleShareEnable`     | 启用公开分享，生成 `share_token`                            |
| DELETE | `/api/snippets/:id/share`                    | `handleShareRevoke`     | 撤销公开分享                                                |
| GET    | `/api/snippets/public/:token`                | `handlePublicGet`       | **无需登录**：公开只读视图（脱敏字段）                      |

> 列表分页：`limit` 默认 50、上限 100；游标 `cursor` 基于排序键编码；最多保留 20 条/片段 的历史版本（`REVISIONS_RETAIN_PER_SNIPPET`）。
> 单条代码体大小上限：`MAX_CODE_BYTES = 1MB`。

---

## 5. D1 数据库结构（脚本库）

迁移顺序敏感，部署时遍历 `migrations/*.sql` 执行；重复跑 `0004 / 0005` 出现 `duplicate column` 可忽略（SQLite 不支持 `ADD COLUMN IF NOT EXISTS`）。

| 表 / 虚表           | 用途                               | 关键列                                                                                                                                                                                            |
| ------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snippets`          | 脚本主表                           | `id` PK, `title`, `language`, `code`, `description`, `tags`(JSON), `favorite`, `created_at`, `updated_at`, `deleted_at`, `view_count`, `share_token`(UNIQUE), `share_enabled`, `share_created_at` |
| `snippets_fts`      | FTS5 全文索引（trigram tokenizer） | `id`(UNINDEXED), `title`, `description`, `code`, `tags`                                                                                                                                           |
| `snippet_revisions` | 历史版本                           | `id` AUTOINCREMENT, `snippet_id`, 完整内容快照 + `created_at`                                                                                                                                     |
| `auth_settings`     | 持久化 PBKDF2 哈希（升级写回）     | `k` PK, `v`, `updated_at`                                                                                                                                                                         |
| `login_attempts`    | 登录限流计数（按 IP）              | `ip` PK, `fail_count`, `first_failed_at`, `blocked_until`                                                                                                                                         |

触发器（在 `0004_snippets_v2.sql`）保证 `snippets` ↔ `snippets_fts` 自动同步：`snippets_ai`（insert）、`snippets_ad`（delete）、`snippets_au`（update of title/description/code/tags）。

---

## 6. 前端功能模块对照表

> 路径相对仓库根目录。同名功能可能被多文件协作实现，下列只列主入口。

### 6.1 主站（`/`）核心模块

| 功能                                          | 主要文件                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| 应用根 + 装配所有 hook / 模态框               | `src/App.tsx`                                                                 |
| 路由分发（`/`, `/scripts`, `/share/:token`）  | `src/main.tsx`                                                                |
| 类型定义（链接、分类、同步、片段等）          | `src/types.ts`                                                                |
| 全局常量 / LocalStorage key / 设备指纹        | `src/utils/constants.ts`                                                      |
| 隐私分组（AES 加密保险库）                    | `src/utils/privateVault.ts`（加解密） + `App.tsx` 中的 `privateLinks` 状态    |
| 主题（亮/暗/系统）                            | `src/hooks/useTheme.ts` + `index.html` 的 flash 防抖脚本                      |
| 链接数据存储（CRUD + 排序 + 置顶 + 图标缓存） | `src/hooks/useDataStore.ts`                                                   |
| 搜索（内置 / 外部多源）                       | `src/hooks/useSearch.ts` + `src/components/modals/SearchConfigModal.tsx`      |
| 站点设置（标题 / 配色 / 卡片样式 / 背景）     | `src/hooks/useConfig.ts` + `src/components/modals/settings/AppearanceTab.tsx` |
| 上下文菜单                                    | `src/hooks/useContextMenu.ts` + `src/components/layout/ContextMenu.tsx`       |
| 模态框统一管理                                | `src/hooks/useModals.ts` + `src/components/ui/DialogProvider.tsx`             |
| 批量编辑                                      | `src/hooks/useBatchEdit.ts`                                                   |
| 拖拽排序（dnd-kit）                           | `src/hooks/useSorting.ts` + `src/components/ui/SortableLinkCard.tsx`          |
| 侧栏分类                                      | `src/hooks/useSidebar.ts` + `src/components/layout/Sidebar.tsx`               |
| 顶部 Header（搜索框 / 操作按钮）              | `src/components/layout/MainHeader.tsx`                                        |
| 链接卡片网格区块                              | `src/components/layout/LinkSections.tsx`                                      |
| 单个链接卡片                                  | `src/components/ui/LinkCard.tsx` + `src/utils/iconTone.ts`                    |
| Lucide 图标 / 自定义 emoji 选择器             | `src/components/ui/Icon.tsx` + `src/components/ui/IconSelector.tsx`           |
| 链接 / 分类 / 导入 / 设置 / 搜索源 弹窗       | `src/components/modals/*.tsx`                                                 |
| 设置弹窗内分页（AI / 外观 / 数据 / 站点）     | `src/components/modals/settings/*.tsx`                                        |
| 同步引擎（debounce 写入 + 冲突上报）          | `src/hooks/useSyncEngine.ts`                                                  |
| 同步冲突解决 UI                               | `src/components/modals/SyncConflictModal.tsx`                                 |
| 同步状态徽标                                  | `src/components/ui/SyncStatusIndicator.tsx`                                   |
| Bookmarklet 快速添加链接                      | `src/hooks/useBookmarkletQuickAdd.ts`                                         |
| 浏览器书签 HTML 解析（用于导入）              | `src/services/bookmarkParser.ts`                                              |
| 导出 JSON / 浏览器书签                        | `src/services/exportService.ts`                                               |
| AI（Gemini / OpenAI 兼容）调用                | `src/services/geminiService.ts`（按需 dynamic import `@google/genai`）        |

### 6.2 脚本库（`/scripts`）模块

| 功能                                  | 文件                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 页面根（登录态/列表/编辑 状态机）     | `src/components/scripts/ScriptsVault.tsx`                                                                                        |
| 登录界面                              | `src/components/scripts/ScriptsLogin.tsx`                                                                                        |
| 列表上方头部 / 操作按钮               | `src/components/scripts/ScriptsVaultHeader.tsx`                                                                                  |
| 筛选条（语言 / 标签 / 排序 / 回收站） | `src/components/scripts/ScriptsVaultFilters.tsx`                                                                                 |
| 数据 hook（列表 / 详情 / 草稿）       | `src/components/scripts/useScriptsVaultData.ts`                                                                                  |
| API 客户端                            | `src/services/snippetService.ts`                                                                                                 |
| 片段列表（虚拟滚动）                  | `src/components/scripts/SnippetList.tsx`                                                                                         |
| 片段查看器                            | `src/components/scripts/SnippetViewer.tsx`                                                                                       |
| 片段编辑器（Monaco）                  | `src/components/scripts/SnippetEditor.tsx` + `MonacoCodeEditor.tsx`                                                              |
| 代码块渲染 + 高亮                     | `src/components/scripts/CodeBlock.tsx` + `highlight.ts` + `code-theme.css`（Shiki 双主题 vitesse-light/dark，按语言动态 import） |
| 全文检索关键字高亮                    | `src/components/scripts/HighlightText.tsx`                                                                                       |
| 批量操作工具栏                        | `src/components/scripts/BatchActionBar.tsx`                                                                                      |
| 复制并替换占位变量                    | `src/components/scripts/CopyWithVarsButton.tsx`                                                                                  |
| 历史版本对比 / 还原                   | `src/components/scripts/SnippetHistoryModal.tsx`                                                                                 |
| 公开分享设置                          | `src/components/scripts/SnippetShareModal.tsx`                                                                                   |
| 公开分享只读页（`/share/:token`）     | `src/components/scripts/PublicSnippetView.tsx`                                                                                   |

### 6.3 共享 UI 基础设施

| 功能                 | 文件                                   |
| -------------------- | -------------------------------------- |
| 全局对话框/确认/通知 | `src/components/ui/DialogProvider.tsx` |
| 通用图标包装         | `src/components/ui/Icon.tsx`           |

---

## 7. 部署 / 运行命令一览（来自 `package.json`）

| 命令                     | 含义                                                      |
| ------------------------ | --------------------------------------------------------- |
| `npm run dev`            | Vite 开发服务（`http://localhost:3000`）                  |
| `npm run build`          | 生产构建 → `dist/`                                        |
| `npm run preview`        | 预览构建产物                                              |
| `npm run dev:workers`    | 先 build，再 `wrangler dev` 起本地 Worker（含 KV / D1）   |
| `npm run deploy:workers` | build + `wrangler deploy`                                 |
| `npm run deploy:pages`   | build + `wrangler pages deploy dist --project-name=y-nav` |
| `npm run kv:create`      | 一键创建 `YNAV_WORKER_KV` 命名空间                        |
| `npm run typecheck`      | `tsc --noEmit`（前端） + Worker 端类型检查                |
| `npm run lint` / `:fix`  | ESLint                                                    |
| `npm run format[:check]` | Prettier                                                  |
| `npm test`               | Vitest（jsdom）                                           |
| `npm run test:watch`     | Vitest watch                                              |
| `npm run test:coverage`  | v8 coverage（include 列表见 `vitest.config.ts`）          |
| `npm run hash:password`  | 生成脚本库密码的 PBKDF2 哈希                              |

部署所需的 Cloudflare 绑定 / Secrets（Workers 形态）：

- KV：`YNAV_WORKER_KV`（导航数据 + 备份）
- D1：`SNIPPETS_DB`（脚本库）
- Secret：`SNIPPETS_PASSWORD_HASH`、`SNIPPETS_SESSION_SECRET`
- 可选环境变量：`SYNC_PASSWORD`（主站同步密码）

详见根 `README.md` 与 `wrangler.toml` 顶部注释。

---

## 8. 常见维护场景速查

| 任务                               | 优先打开的文件                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 新增前端路由 / 顶级页面            | `src/main.tsx`                                                                                                         |
| 新增 / 修改 `/api/snippets/*` 接口 | `worker/snippets.ts`（路由表在 `handleSnippetsRequest` 函数底部）                                                      |
| 新增 / 修改 `/api/sync*` 接口      | `worker/index.ts` 的 `handleApiSync` + `functions/api/sync.ts`（如要兼顾 Pages 部署）                                  |
| 改 KV 数据形状 / 同步协议          | `src/types.ts`（`YNavSyncData`） + `worker/index.ts` + `src/hooks/useSyncEngine.ts`                                    |
| 改 D1 表结构                       | 在 `migrations/` 加一个新的 `000N_*.sql`，**禁止**修改历史迁移                                                         |
| 改主题 / 配色 / 卡片样式           | `src/hooks/useTheme.ts`, `src/hooks/useConfig.ts`, `src/components/modals/settings/AppearanceTab.tsx`, `src/index.css` |
| 改安全响应头 / CSP                 | `worker/index.ts` 的 `BASELINE_SECURITY_HEADERS` / `HTML_CSP`                                                          |
| 接入新的 AI 提供商                 | `src/services/geminiService.ts` + `src/components/modals/settings/AITab.tsx`                                           |
| 改脚本库登录策略 / Cookie / 限流   | `worker/snippets.ts` 顶部常量 + `handleLogin` / `requireSession`                                                       |
| 改 Vite 构建分包                   | `vite.config.ts` 的 `build.rollupOptions.output.manualChunks`                                                          |
| 改 CI 流程                         | `.github/workflows/ci.yml`, `.github/workflows/deploy-workers.yml`                                                     |

---

## 9. 维护文档的约定

- 任何对**路由 / API / 数据库 schema / 主要模块文件位置**的变更，请同步更新本文件相应小节。
- 路径变动 > 行为变动 > 命名变动：本文件的目标是让"AI 不读全仓也能定位到正确入口"，所以**路径必须最新**。
- 不要在这里贴大段代码，让读者通过表格 + 路径自行打开。
