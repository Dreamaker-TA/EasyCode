/**
 * 把 @monaco-editor/react 的 CDN 加载改为本地 npm 包加载。
 *
 * 默认 loader.init() 从 jsdelivr 拉 monaco，国内或离线环境会卡死。
 * 这里 self-host：只在 CodeEditor 所在的懒加载路由里给 loader 注入 monaco namespace，
 * 并用 Vite `?worker` 后缀把基础 editor worker 编入 bundle。
 *
 * 不要从 main.tsx 顶层导入本文件；否则首页、设置页、复习页也会为 Monaco 付首载成本。
 */

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";

import { tokens } from "@/styles/tokens";

/** 暖纸浅色主题 id（对齐应用 --bg-elevated）。 */
export const MONACO_THEME_LIGHT = "easycode-paper";
/** 暖墨深色主题 id（取代 vs-dark 冷蓝黑）。 */
export const MONACO_THEME_DARK = "easycode-ink";

type MonacoThemeTokens = typeof tokens.monaco.paper | typeof tokens.monaco.ink;

/**
 * 把 tokens.monaco 的一套数值翻译成 monaco defineTheme 入参。
 * hex 全部来自 tokens.ts，本文件不出现字面色值。
 * monaco 的颜色键不接受 alpha 短写以外的格式，这里只传 6 位 hex。
 */
function toThemeData(t: MonacoThemeTokens): monaco.editor.IStandaloneThemeData {
  return {
    base: t.base,
    inherit: true,
    // Monarch python tokenizer 的作用域 → 暖调语法色。
    rules: [
      { token: "keyword", foreground: strip(t.keyword) },
      { token: "keyword.python", foreground: strip(t.keyword) },
      { token: "string", foreground: strip(t.string) },
      { token: "string.python", foreground: strip(t.string) },
      { token: "string.escape", foreground: strip(t.string) },
      { token: "comment", foreground: strip(t.comment), fontStyle: "italic" },
      { token: "number", foreground: strip(t.number) },
      { token: "constant", foreground: strip(t.number) },
      { token: "identifier", foreground: strip(t.variable) },
      { token: "type", foreground: strip(t.type) },
      { token: "type.identifier", foreground: strip(t.type) },
      { token: "predefined", foreground: strip(t.func) },
      { token: "predefined.python", foreground: strip(t.func) },
      { token: "operator", foreground: strip(t.operator) },
      { token: "delimiter", foreground: strip(t.punctuation) },
    ],
    colors: {
      "editor.background": t.bg,
      "editor.foreground": t.fg,
      "editor.lineHighlightBackground": t.lineHighlight,
      "editor.lineHighlightBorder": t.lineHighlight,
      "editor.selectionBackground": t.selection,
      "editor.inactiveSelectionBackground": t.selection,
      "editor.selectionHighlightBackground": t.selectionHighlight,
      "editorCursor.foreground": t.cursor,
      "editorLineNumber.foreground": t.gutterFg,
      "editorLineNumber.activeForeground": t.gutterActiveFg,
      "editorGutter.background": t.bg,
      "editorIndentGuide.background": t.indentGuide,
      "editorIndentGuide.activeBackground": t.indentGuideActive,
      "editorWhitespace.foreground": t.whitespace,
      "editorWidget.background": t.bg,
      "editorWidget.border": t.indentGuideActive,
      "scrollbarSlider.background": withAlpha(t.scrollbarSlider, "aa"),
      "scrollbarSlider.hoverBackground": withAlpha(t.scrollbarSlider, "dd"),
      "scrollbarSlider.activeBackground": t.scrollbarSlider,
      "editorOverviewRuler.border": t.indentGuide,
      // 括号对着色：默认那组洋红 / 亮蓝 / 金彩虹与暖纸调冲突，六级全部回落到
      // punctuation 暖灰（等同于关掉彩虹），未匹配括号用 danger 提示。
      "editorBracketHighlight.foreground1": t.punctuation,
      "editorBracketHighlight.foreground2": t.punctuation,
      "editorBracketHighlight.foreground3": t.punctuation,
      "editorBracketHighlight.foreground4": t.punctuation,
      "editorBracketHighlight.foreground5": t.punctuation,
      "editorBracketHighlight.foreground6": t.punctuation,
      "editorBracketHighlight.unexpectedBracket.foreground": t.keyword,
    },
  };
}

/** monaco rules.foreground 要去掉 `#`。 */
function strip(hex: string): string {
  return hex.replace(/^#/, "");
}

/** 给 6 位 hex 追加 alpha（滚动条槽用半透明，避免盖住底纹）。 */
function withAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

monaco.editor.defineTheme(
  MONACO_THEME_LIGHT,
  toThemeData(tokens.monaco.paper),
);
monaco.editor.defineTheme(MONACO_THEME_DARK, toThemeData(tokens.monaco.ink));

// Python 用基础 editor worker 即可。语法高亮走 basic language monarch
// tokenizer，不启用 TS/CSS/HTML/JSON 语言服务 worker。

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: (workerId: string, label: string) => Worker;
    };
  }
}

window.MonacoEnvironment = {
  getWorker(_workerId, _label) {
    return new editorWorker();
  },
};

loader.config({ monaco });

export {};
