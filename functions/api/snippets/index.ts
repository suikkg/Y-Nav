/**
 * /api/snippets
 *   GET  - 列出所有脚本 (按 updated_at desc)
 *   POST - 新建脚本
 *
 * 鉴权: HttpOnly Cookie 会话。
 */
import {
    ApiSnippet,
    DBSnippetRow,
    SnippetsEnv,
    errorResponse,
    generateId,
    jsonResponse,
    normalizeTags,
    requireSession,
    rowToSnippet,
} from './_lib';

const MAX_CODE_BYTES = 1024 * 1024; // 1 MiB 上限

function validateString(value: unknown, max: number): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export const onRequestGet = async (context: { request: Request; env: SnippetsEnv }) => {
    const { request, env } = context;
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;

    try {
        const { results } = await env.SNIPPETS_DB
            .prepare('SELECT * FROM snippets ORDER BY updated_at DESC')
            .all<DBSnippetRow>();
        const snippets: ApiSnippet[] = (results || []).map(rowToSnippet);
        return jsonResponse({ success: true, snippets });
    } catch (err: any) {
        return errorResponse(500, err?.message || '读取失败');
    }
};

export const onRequestPost = async (context: { request: Request; env: SnippetsEnv }) => {
    const { request, env } = context;
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;

    let body: any;
    try {
        body = await request.json();
    } catch {
        return errorResponse(400, '请求格式错误');
    }

    const title = validateString(body?.title, 200);
    const language = validateString(body?.language, 40) || 'text';
    const code = typeof body?.code === 'string' ? body.code : '';
    const description = validateString(body?.description, 2000);
    const tags = normalizeTags(body?.tags);
    const favorite = !!body?.favorite;

    if (!title) return errorResponse(400, '标题不能为空');
    if (!code) return errorResponse(400, '代码不能为空');
    if (new TextEncoder().encode(code).byteLength > MAX_CODE_BYTES) {
        return errorResponse(413, '代码内容过大');
    }

    const id = generateId();
    const now = new Date().toISOString();

    try {
        await env.SNIPPETS_DB
            .prepare(
                `INSERT INTO snippets (id, title, language, code, description, tags, favorite, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
                id,
                title,
                language,
                code,
                description || null,
                JSON.stringify(tags),
                favorite ? 1 : 0,
                now,
                now
            )
            .run();
    } catch (err: any) {
        return errorResponse(500, err?.message || '写入失败');
    }

    const snippet: ApiSnippet = {
        id,
        title,
        language,
        code,
        description: description || undefined,
        tags,
        favorite,
        createdAt: now,
        updatedAt: now,
    };
    return jsonResponse({ success: true, snippet }, { status: 201 });
};

export const onRequest = async () => errorResponse(405, 'Method not allowed');
