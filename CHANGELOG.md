# 更新日志

本仓库的脚本库 (`/scripts`) 与基础架构在 2026-05 完成一次大版本重构。
本文档汇总各阶段的关键改动；详细 diff 请查阅 git 历史。

## 2026-05 重构 (P0 → P8)

### P0 — 工具链 / 类型严格度

- 引入 **ESLint 9 flat config** + **Prettier 3**，前端 / Worker / scripts 三套规则。
- `tsconfig.json` 启用 `strict`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`noImplicitOverride`、`forceConsistentCasingInFileNames`；新增 `WebWorker` lib。
- 新增 `worker/types.d.ts` 处理 `__STATIC_CONTENT_MANIFEST` 模块声明。
- 接入 GitHub Actions: typecheck (前端 + Worker) / lint / format / unit tests / build smoke test。
- `npm run hash:password` CLI 工具，输出 PBKDF2 字符串。

### P1 — 鉴权升级

- 脚本库密码哈希从 **SHA-256** 升级到 **PBKDF2-SHA256 (200k 迭代 + 16B salt)**。
- 旧 SHA-256 / 明文密码仍然兼容，首次登录后自动写入新格式到 D1 `auth_settings`。
- Session token 使用 **HMAC-SHA256** 签名，TTL 10 分钟，滑动续期 (剩余 < 5 分钟时刷新)。
- Cookie 使用 `__Host-` 前缀 (HttpOnly + Secure + Path=/，不带 Domain)。
- 登录限流: 5 次失败 / 15 分钟窗口 → 锁定 15 分钟，响应 429 + `Retry-After`。
- 全局响应安全头: CSP / X-Frame-Options / Referrer-Policy / Permissions-Policy / COOP / nosniff。
- `X-Requested-With: ynav` 作为 CSRF 双保险，后端拒绝缺失该头的非 GET 请求。

### P2 — 性能

- highlight.js 按语言**动态 import**，移除 30+ 静态导入；首屏 bundle 大幅瘦身。
- 代码 ≥ 50KB 时高亮在 **Web Worker** 中执行，避免阻塞主线程 (Vite `?worker`)。
- `@google/genai` 改为按需 import，从主 chunk 移除。

### P3 — 后端能力

- 迁移 `0004_snippets_v2.sql`:
  - 软删除 `deleted_at`、查看次数 `view_count`
  - **FTS5 trigram tokenizer** 表 + 3 个同步触发器 (insert/delete/update)
  - 版本历史表 `snippet_revisions` (默认保留 20 条 / 脚本)
- 列表 API 支持 `q` / `lang` / `tag` / `favorite` / `trashed` / `sort` / `cursor` / `limit`。
- 游标分页 (base64url JSON `{v, i}` keyset)；FTS 查询走单独路径。
- 更新走 **If-Match 乐观锁**，冲突返回 412；变更前自动写入版本历史。
- 软删除 / 恢复 / 永久删除 API；版本历史读取与恢复 API。

### P4 — 编辑体验

- **Monaco Editor** 替换 textarea (本地 loader，无 CDN；Vite `?worker` 切分语言 worker)；明暗主题跟随。
- SnippetEditor: **焦点陷阱** + Esc 关闭 + ⌘/Ctrl+S 保存快捷键。
- 编辑草稿自动保存到 `sessionStorage` (2s debounce)；下次打开恢复并提示。
- 列表 **虚拟滚动** (`@tanstack/react-virtual`)。
- 列表 / 详情 关键词高亮 (`<mark>`)。
- 复制按钮支持检测 `${VAR}` / `{{name}}` 占位符 → 弹层填充后再复制。
- 登录页: 显示密码切换、429 倒计时锁定状态。
- 移动端：列表 → 详情单栏切换 + "返回列表" 按钮。

### P5 — 新功能

- 排序下拉 (`updated/created/title × asc/desc`) 持久化到 localStorage。
- 仅收藏过滤。
- **回收站** 视图: 查看 / 恢复 / 永久删除。
- **版本历史** 抽屉: 时间线 + 预览 + 恢复。
- **批量选择**: 多选 → 删除 / 加收藏 / 取消收藏 / 添加标签 (带进度提示)。
- **导入 / 导出** JSON (导出当前过滤结果；导入逐条创建，跳过失败项)。
- **公开分享** (默认开): `POST /:id/share` 生成 24B 随机 token，`/share/:token` 只读视图。撤销立即失效。返回脱敏字段 (无 tags / favorite / 内部 ID / viewCount)。

### P6 — 架构重构

- ScriptsVault (1242 → 247 行) 拆分:
  - `useScriptsVaultData.ts` — 状态 + 副作用 + handlers
  - `ScriptsVaultHeader.tsx` — 顶部 bar
  - `ScriptsVaultFilters.tsx` — 筛选区
- App.tsx 抽出 `useBookmarkletQuickAdd` 处理书签 quick-add URL。

### P7 — 测试

- 引入 **Vitest + jsdom + @testing-library**。
- 覆盖关键纯逻辑: `detectPlaceholders`、`substituteVariables`、`HighlightText`。
- 接入 CI: `npm test` 在每次 PR / push 自动运行。

### P8 — 文档

- 本 CHANGELOG。
- README / wrangler.toml 更新部署步骤，新增 0005 迁移、`/share/:token` 路由说明。

## 升级注意

从旧版本升级到本次重构：

1. 运行所有 D1 迁移（按编号顺序）：
   ```bash
   for f in migrations/*.sql; do
     wrangler d1 execute snippets-db --remote --file="$f"
   done
   ```
2. 旧的 SHA-256 `SNIPPETS_PASSWORD_HASH` secret **无需更换**；首次登录后自动升级到 PBKDF2。
3. 如需轮换脚本库密码：
   ```bash
   npm run hash:password          # 生成新 pbkdf2$... 字符串
   wrangler secret put SNIPPETS_PASSWORD_HASH
   wrangler d1 execute snippets-db --remote \
     --command="DELETE FROM auth_settings WHERE k='password_hash'"
   ```
4. `SNIPPETS_SESSION_SECRET` 仍是必需的 (≥ 32 字节随机串)。
