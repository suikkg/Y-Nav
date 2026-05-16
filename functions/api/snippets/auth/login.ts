/**
 * POST /api/snippets/auth/login
 * Body: { password: string }
 * 成功后下发 HttpOnly Cookie 会话。
 */
import {
    SnippetsEnv,
    buildSessionCookie,
    createSessionToken,
    errorResponse,
    verifyPassword,
} from '../_lib';

export const onRequestPost = async (context: { request: Request; env: SnippetsEnv }) => {
    const { request, env } = context;

    if (!env.SNIPPETS_PASSWORD_HASH || !env.SNIPPETS_SESSION_SECRET) {
        return errorResponse(500, '服务端未配置 SNIPPETS_PASSWORD_HASH / SNIPPETS_SESSION_SECRET');
    }

    let body: { password?: unknown } = {};
    try {
        body = (await request.json()) as { password?: unknown };
    } catch {
        return errorResponse(400, '请求格式错误');
    }

    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) return errorResponse(400, '请输入密码');

    const ok = await verifyPassword(password, env);
    if (!ok) return errorResponse(401, '密码错误');

    const token = await createSessionToken(env);
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    headers.append('Set-Cookie', buildSessionCookie(token));

    return new Response(JSON.stringify({ success: true }), { headers });
};

export const onRequest = async () => errorResponse(405, 'Method not allowed');
