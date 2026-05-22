import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  configureMonacoLoaderOnce,
  getInitialMonacoTheme,
  normalizeMonacoLanguage,
  observeMonacoTheme,
} from './monacoSetup';

interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  /** 同语言时只传 language；不同语言时可分别指定 */
  language?: string;
  originalLanguage?: string;
  modifiedLanguage?: string;
  height?: string | number;
  /** 默认 true：左右双栏；false：上下统一视图（unified） */
  renderSideBySide?: boolean;
}

const MonacoDiffEditor: React.FC<MonacoDiffEditorProps> = ({
  original,
  modified,
  language,
  originalLanguage,
  modifiedLanguage,
  height = 480,
  renderSideBySide = true,
}) => {
  configureMonacoLoaderOnce();

  const [theme, setTheme] = useState<'vs' | 'vs-dark'>(getInitialMonacoTheme);
  useEffect(() => observeMonacoTheme(setTheme), []);

  return (
    <div className="h-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
      <DiffEditor
        original={original}
        modified={modified}
        originalLanguage={normalizeMonacoLanguage(originalLanguage || language)}
        modifiedLanguage={normalizeMonacoLanguage(modifiedLanguage || language)}
        theme={theme}
        height={height}
        loading={
          <div className="flex items-center justify-center h-full text-sm text-slate-400">
            加载差异视图...
          </div>
        }
        options={{
          readOnly: true,
          renderSideBySide,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          renderOverviewRuler: false,
          diffWordWrap: 'on',
          ignoreTrimWhitespace: false,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace',
        }}
      />
    </div>
  );
};

export default MonacoDiffEditor;
