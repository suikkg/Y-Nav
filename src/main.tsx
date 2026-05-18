import React, { lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DialogProvider } from './components/ui/DialogProvider';
import './index.css';

const ScriptsVault = lazy(() => import('./components/scripts/ScriptsVault'));
const PublicSnippetView = lazy(() => import('./components/scripts/PublicSnippetView'));

const SCRIPTS_PATH_PREFIX = '/scripts';
const SHARE_PATH_PREFIX = '/share/';

type Route =
  | { kind: 'home' }
  | { kind: 'scripts' }
  | { kind: 'share'; token: string };

function detectRoute(): Route {
  if (typeof window === 'undefined') return { kind: 'home' };
  const p = window.location.pathname;
  if (p === SCRIPTS_PATH_PREFIX || p.startsWith(SCRIPTS_PATH_PREFIX + '/')) {
    return { kind: 'scripts' };
  }
  if (p.startsWith(SHARE_PATH_PREFIX)) {
    const token = p.slice(SHARE_PATH_PREFIX.length).replace(/\/+$/, '');
    if (token) return { kind: 'share', token };
  }
  return { kind: 'home' };
}

const Router: React.FC = () => {
  const [route, setRoute] = useState<Route>(() => detectRoute());

  useEffect(() => {
    const handler = () => setRoute(detectRoute());
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  if (route.kind === 'scripts') {
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
            setRoute({ kind: 'home' });
          }}
        />
      </Suspense>
    );
  }

  if (route.kind === 'share') {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">
            加载中...
          </div>
        }
      >
        <PublicSnippetView token={route.token} />
      </Suspense>
    );
  }

  return <App />;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <DialogProvider>
      <Router />
    </DialogProvider>
  </React.StrictMode>,
);
