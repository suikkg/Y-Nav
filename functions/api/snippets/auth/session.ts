/**
 * GET /api/snippets/auth/session
 * 返回当前是否登录。前端通过该接口判断会话状态。
 */
import {
    SnippetsEnv,
    errorResponse,
    getSessionCookie,
    verifySessionToken,
} from '../_lib';

export const onRequestGet = async (context: { request: Request; env: SnippetsEnv }) => {
    const { request, env } = context;
    const configured = !!(env.SNIPPETS_PASSWORD_HASH && env.SNIPPETS_SESSION_SECRET);

    const token = getSessionCookie(request);
    if (!token) {
        return new Response(
            JSON.stringify({ success: true, authenticated: false, configured }),
            { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        );
    }
    const payload = await verifySessionToken(token, env);
    return new Response(
        JSON.stringify({
            success: true,
            authenticated: !!payload,
            configured,
            expiresAt: payload?.exp ?? null,
        }),
        { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
};

export const onRequest = async () => errorResponse(405, 'Method not allowed');
