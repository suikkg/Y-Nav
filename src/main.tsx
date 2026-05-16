import React, { lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DialogProvider } from './components/ui/DialogProvider';
import './index.css';

const ScriptsVault = lazy(() => import('./components/scripts/ScriptsVault'));

const SCRIPTS_PATH_PREFIX = '/scripts';

function isScriptsRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname;
  return p === SCRIPTS_PATH_PREFIX || p.startsWith(SCRIPTS_PATH_PREFIX + '/');
}

const Router: React.FC = () => {
  const [onScripts, setOnScripts] = useState<boolean>(() => isScriptsRoute());

  useEffect(() => {
    const handler = () => setOnScripts(isScriptsRoute());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  if (onScripts) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">
            加载中...
          </div>
        }
      >
        <ScriptsVault
          onExit={() => {
            window.history.pushState({}, '', '/');
            setOnScripts(false);
          }}
        />
      </Suspense>
    );
  }

  return <App />;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <DialogProvider>
      <Router />
    </DialogProvider>
  </React.StrictMode>
);
