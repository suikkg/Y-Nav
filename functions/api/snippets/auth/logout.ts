/**
 * POST /api/snippets/auth/logout
 * 清空会话 Cookie。
 */
import { buildClearSessionCookie, errorResponse } from '../_lib';

export const onRequestPost = async () => {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
    headers.append('Set-Cookie', buildClearSessionCookie());
    return new Response(JSON.stringify({ success: true }), { headers });
};

export const onRequest = async () => errorResponse(405, 'Method not allowed');
