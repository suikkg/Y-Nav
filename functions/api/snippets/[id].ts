/**
 * /api/snippets/:id
 *   GET    - 获取单个脚本
 *   PUT    - 更新脚本
 *   DELETE - 删除脚本
 */
import {
    ApiSnippet,
    DBSnippetRow,
    SnippetsEnv,
    errorResponse,
    jsonResponse,
    normalizeTags,
    requireSession,
    rowToSnippet,
} from './_lib';

const MAX_CODE_BYTES = 1024 * 1024;

interface RouteContext {
    request: Request;
    env: SnippetsEnv;
    params: { id: string };
}

function validateString(value: unknown, max: number): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

async function fetchById(env: SnippetsEnv, id: string): Promise<DBSnippetRow | null> {
    return env.SNIPPETS_DB
        .prepare('SELECT * FROM snippets WHERE id = ?')
        .bind(id)
        .first<DBSnippetRow>();
}

export const onRequestGet = async (context: RouteContext) => {
    const { request, env, params } = context;
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;

    try {
        const row = await fetchById(env, params.id);
        if (!row) return errorResponse(404, '脚本不存在');
        const snippet: ApiSnippet = rowToSnippet(row);
        return jsonResponse({ success: true, snippet });
    } catch (err: any) {
        return errorResponse(500, err?.message || '读取失败');
    }
};

export const onRequestPut = async (context: RouteContext) => {
    const { request, env, params } = context;
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;

    let body: any;
    try {
        body = await request.json();
    } catch {
        return errorResponse(400, '请求格式错误');
    }

    const existing = await fetchById(env, params.id);
    if (!existing) return errorResponse(404, '脚本不存在');

    const title = body?.title !== undefined ? validateString(body.title, 200) : existing.title;
    const language = body?.language !== undefined ? (validateString(body.language, 40) || 'text') : existing.language;
    const code = typeof body?.code === 'string' ? body.code : existing.code;
    const description = body?.description !== undefined ? validateString(body.description, 2000) : (existing.description || '');
    const tags = body?.tags !== undefined ? normalizeTags(body.tags) : JSON.parse(existing.tags || '[]');
    const favorite = body?.favorite !== undefined ? !!body.favorite : !!existing.favorite;

    if (!title) return errorResponse(400, '标题不能为空');
    if (!code) return errorResponse(400, '代码不能为空');
    if (new TextEncoder().encode(code).byteLength > MAX_CODE_BYTES) {
        return errorResponse(413, '代码内容过大');
    }

    const updatedAt = new Date().toISOString();

    try {
        await env.SNIPPETS_DB
            .prepare(
                `UPDATE snippets
                 SET title = ?, language = ?, code = ?, description = ?, tags = ?, favorite = ?, updated_at = ?
                 WHERE id = ?`
            )
            .bind(
                title,
                language,
                code,
                description || null,
                JSON.stringify(tags),
                favorite ? 1 : 0,
                updatedAt,
                params.id
            )
            .run();
    } catch (err: any) {
        return errorResponse(500, err?.message || '更新失败');
    }

    const snippet: ApiSnippet = {
        id: params.id,
        title,
        language,
        code,
        description: description || undefined,
        tags: Array.isArray(tags) ? tags : [],
        favorite,
        createdAt: existing.created_at,
        updatedAt,
    };
    return jsonResponse({ success: true, snippet });
};

export const onRequestDelete = async (context: RouteContext) => {
    const { request, env, params } = context;
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;

    try {
        const row = await fetchById(env, params.id);
        if (!row) return errorResponse(404, '脚本不存在');
        await env.SNIPPETS_DB
            .prepare('DELETE FROM snippets WHERE id = ?')
            .bind(params.id)
            .run();
        return jsonResponse({ success: true });
    } catch (err: any) {
        return errorResponse(500, err?.message || '删除失败');
    }
};

export const onRequest = async () => errorResponse(405, 'Method not allowed');
