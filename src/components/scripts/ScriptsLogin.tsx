import React, { useEffect, useRef, useState } from 'react';
import { Lock, ArrowLeft, Loader2, Eye, EyeOff } from 'lucide-react';
import { login } from '../../services/snippetService';

interface ScriptsLoginProps {
  onLoggedIn: () => void;
  onBack: () => void;
}

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} 秒`;
  return `${m} 分 ${s.toString().padStart(2, '0')} 秒`;
}

const ScriptsLogin: React.FC<ScriptsLoginProps> = ({ onLoggedIn, onBack }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  // 滴答时钟，仅当被锁定时启用
  useEffect(() => {
    if (lockUntil === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockUntil]);

  // 锁定到期时清除状态
  useEffect(() => {
    if (lockUntil !== null && now >= lockUntil) {
      setLockUntil(null);
      setError(null);
      // 焦点回到输入框
      inputRef.current?.focus();
    }
  }, [lockUntil, now]);

  const remainingSec = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
  const isLocked = remainingSec > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    if (!password) {
      setError('请输入密码');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(password);
      onLoggedIn();
    } catch (err) {
      const e = err as Error & { status?: number; retryAfter?: number };
      if (e.status === 429 && e.retryAfter) {
        setLockUntil(Date.now() + e.retryAfter * 1000);
        setNow(Date.now());
        setError(e.message || '尝试次数过多，请稍后再试');
      } else {
        setError(e.message || '登录失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <button
          type="button"
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft size={14} />
          返回主站
        </button>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-accent/10 text-accent flex items-center justify-center">
              <Lock size={18} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">脚本库</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">请输入密码以查看内容</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                密码
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                  className="w-full pl-3 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  placeholder="脚本库密码"
                  disabled={submitting || isLocked}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {isLocked && (
              <div className="text-xs px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
                登录尝试过多，请在 <span className="font-semibold">{formatRemaining(remainingSec)}</span> 后重试。
              </div>
            )}

            {!isLocked && error && (
              <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting || isLocked}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {isLocked ? '已被临时锁定' : '进入'}
            </button>
          </form>
        </div>

        <p className="mt-4 text-xs text-center text-slate-400 dark:text-slate-500">
          会话信息由服务端 HttpOnly Cookie 维护
        </p>
      </div>
    </div>
  );
};

export default ScriptsLogin;
