import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoNs } from "monaco-editor";
import { useEffect, useRef } from "react";

import type { Language } from "@/api/types";
import { useTheme } from "@/hooks/useTheme";
import { MONACO_THEME_DARK, MONACO_THEME_LIGHT } from "@/lib/monaco-setup";

import "./diff-decorations.css";
import styles from "./CodeEditor.module.css";

/** 行级 diff 装饰：整行底色高亮新增 / 变化行。 */
export interface LineDecoration {
  startLine: number;
  endLine: number;
  kind: "add" | "change";
}

interface Props {
  code: string;
  onChange: (next: string) => void;
  /** monaco 语言 id：随所选语言切换语法高亮，默认 python。 */
  language?: Language;
  readOnly?: boolean;
  /**
   * readOnly 下用户尝试编辑时触发(键盘输入 / 粘贴等)。
   * 由 Monaco 原生 `onDidAttemptReadOnlyEdit` 事件驱动,语义贴合"用户想接着写"。
   * 业务层应在首次回调里做防抖 / 状态切换,避免在解锁前重复触发。
   */
  onAttemptReadOnlyEdit?: () => void;
  /**
   * 行装饰：高亮相对上一帧的新增 / 变化行。不传则无任何装饰，
   * 行为与改造前完全一致（写题 / 历史静态场景零影响）。
   */
  decorations?: LineDecoration[];
}

export function CodeEditor({
  code,
  onChange,
  language = "python",
  readOnly = false,
  onAttemptReadOnlyEdit,
  decorations,
}: Props) {
  const { theme } = useTheme();
  const attemptHandlerRef = useRef<(() => void) | undefined>(onAttemptReadOnlyEdit);
  attemptHandlerRef.current = onAttemptReadOnlyEdit;

  const monacoRef = useRef<Monaco | null>(null);
  const decoRef = useRef<MonacoNs.IEditorDecorationsCollection | null>(null);
  // 最新的 decorations 用 ref 兜底，确保 onMount（异步）时拿到的是当前值。
  const decorationsRef = useRef<LineDecoration[] | undefined>(decorations);
  decorationsRef.current = decorations;

  function applyDecorations() {
    const monaco = monacoRef.current;
    const coll = decoRef.current;
    if (!monaco || !coll) return;
    coll.set(
      (decorationsRef.current ?? []).map((d) => ({
        range: new monaco.Range(d.startLine, 1, d.endLine, 1),
        options: {
          isWholeLine: true,
          className:
            d.kind === "add" ? "ec-diff-line-add" : "ec-diff-line-change",
        },
      })),
    );
  }

  const handleMount: OnMount = (editor, monaco) => {
    monacoRef.current = monaco;
    decoRef.current = editor.createDecorationsCollection();
    applyDecorations();

    editor.onDidAttemptReadOnlyEdit(() => {
      attemptHandlerRef.current?.();
    });
  };

  // value 变化由 <Editor>（子组件）的 effect 先同步进 model，再轮到本 effect（父）应用装饰，
  // 故装饰总是落在更新后的内容上。code / decorations 任一变化都重设。
  useEffect(() => {
    applyDecorations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, decorations]);

  return (
    <div className={styles.wrap}>
      <Editor
        height="100%"
        language={language}
        loading={<div className={styles.loading}>正在准备代码编辑器…</div>}
        theme={theme === "dark" ? MONACO_THEME_DARK : MONACO_THEME_LIGHT}
        value={code}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          fontFamily:
            '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
          fontLigatures: true,
          tabSize: 4,
          insertSpaces: true,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          renderLineHighlight: "gutter",
          smoothScrolling: true,
          padding: { top: 16, bottom: 16 },
          readOnly,
          lineNumbersMinChars: 3,
          // 关掉括号对彩虹着色：默认那组高饱和洋红/亮蓝/金色与暖纸调冲突，
          // 关掉后括号回落到 punctuation 暖灰，保持克制。
          bracketPairColorization: { enabled: false },
        }}
      />
    </div>
  );
}
