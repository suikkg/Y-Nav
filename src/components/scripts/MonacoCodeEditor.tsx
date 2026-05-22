import React, { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { Editor } from '@monaco-editor/react';
import {
  configureMonacoLoaderOnce,
  getInitialMonacoTheme,
  normalizeMonacoLanguage,
  observeMonacoTheme,
} from './monacoSetup';

interface MonacoCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string | number;
  /** 触发于编辑器内 ⌘/Ctrl+S */
  onSave?: () => void;
  /** 自动聚焦 */
  autoFocus?: boolean;
}

const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  value,
  onChange,
  language,
  height = 380,
  onSave,
  autoFocus = false,
}) => {
  configureMonacoLoaderOnce();

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // 主题跟随 <html class="dark">
  const [theme, setTheme] = useState<'vs' | 'vs-dark'>(getInitialMonacoTheme);
  useEffect(() => observeMonacoTheme(setTheme), []);

  const handleMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });
    if (autoFocus) editor.focus();
  };

  return (
    <div className="h-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
      <Editor
        value={value}
        onChange={(v) => onChange(v ?? '')}
        language={normalizeMonacoLanguage(language)}
        theme={theme}
        height={height}
        onMount={handleMount}
        loading={
          <div className="flex items-center justify-center h-full text-sm text-slate-400">
            加载编辑器...
          </div>
        }
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          automaticLayout: true,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          renderLineHighlight: 'gutter',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace',
        }}
      />
    </div>
  );
};

export default MonacoCodeEditor;
