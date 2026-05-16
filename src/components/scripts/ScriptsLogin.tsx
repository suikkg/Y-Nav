import React, { useState } from 'react';
import { Lock, ArrowLeft, Loader2 } from 'lucide-react';
import { login } from '../../services/snippetService';

interface ScriptsLoginProps {
  onLoggedIn: () => void;
  onBack: () => void;
}

const ScriptsLogin: React.FC<ScriptsLoginProps> = ({ onLoggedIn, onBack }) => {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('请输入密码');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(password);
      onLoggedIn();
    } catch (err: any) {
      setError(err?.message || '登录失败');
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
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60 transition"
                placeholder="脚本库密码"
                disabled={submitting}
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              进入
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
