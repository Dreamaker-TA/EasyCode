import { useCallback, useEffect, useState } from "react";

import { useDebouncedValue } from "./useDebouncedValue";
import type { Language } from "@/api/types";

// 草稿按 (problemId, language) 分键：换语言 → 换草稿，互不串味。
function draftKey(problemId: number, language: Language) {
  return `easycode:draft:${problemId}:${language}`;
}

// 起始模板清理：命中（去空白后相等）视为「未作答」，
// 允许被新的 LeetCode 外壳模板覆盖，避免 localStorage 里残留旧 stub 顶掉新模板。
const LEGACY_DEFAULTS = [
  "from typing import List\n\n\nclass Solution:\n    def solve(self) -> None:\n        # 在这里开始写代码\n        pass",
  "// ACM 模式：从标准输入读入，处理后用 console.log 输出\nconst lines = require('fs').readFileSync(0, 'utf8').split('\\n');\n\n// 在这里开始写代码",
];

function isSeedable(existing: string | null): boolean {
  if (!existing || existing.trim() === "") return true;
  const trimmed = existing.trim();
  return LEGACY_DEFAULTS.some((d) => trimmed === d.trim());
}

/**
 * 该草稿是否是"用户真正改动过、值得挽留的残留"（准备页断点续答提示用）。
 * 排除：空 / 旧默认模板 / 与当前起始模板逐字（去空白后）相等 —— 这些都视为"没动过手"。
 */
export function hasUserEdits(
  existing: string | null,
  template?: string | null,
): boolean {
  if (isSeedable(existing)) return false;
  if (template && existing!.trim() === template.trim()) return false;
  return true;
}

/** 直接读某题某语言的代码草稿（无需实例化 hook；准备页残留检测用）。 */
export function getProblemDraft(
  problemId: number,
  language: Language,
): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(draftKey(problemId, language));
}

/** 清空某题所有语言的代码草稿（"清空新建"用）。 */
export function clearProblemDrafts(problemId: number, languages: Language[]): void {
  if (typeof window === "undefined") return;
  for (const lang of languages) {
    window.localStorage.removeItem(draftKey(problemId, lang));
  }
}

/**
 * 编辑器代码草稿。
 *
 * 默认起始内容为空：
 * 开题时由页面按「输入输出格式 + 该题模板」决定，并通过 `seed` 写入。
 */
export function useCodeDraft(problemId: number, language: Language = "python") {
  const key = draftKey(problemId, language);

  // 切换 problemId / language 时重新读 localStorage
  const [code, setCode] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(key) ?? "";
  });

  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    setCode(stored ?? "");
  }, [key]);

  const debounced = useDebouncedValue(code, 500);
  useEffect(() => {
    window.localStorage.setItem(key, debounced);
  }, [debounced, key]);

  const clear = useCallback(() => {
    window.localStorage.removeItem(key);
    setCode("");
  }, [key]);

  // 按指定语言播种起始模板：直接写该语言的草稿键（不依赖 hook 当前 language，
  // 规避「开题时 language 还是默认 python、startOrResume 之后才切到所选语言」的竞态）。
  // 目标语言与当前渲染语言一致时同步 setCode，让编辑器立即反映。
  const seed = useCallback(
    (targetLanguage: Language, content: string, opts?: { onlyIfEmpty?: boolean }) => {
      const targetKey = draftKey(problemId, targetLanguage);
      if (opts?.onlyIfEmpty && !isSeedable(window.localStorage.getItem(targetKey))) {
        return; // 已有真实作答，不覆盖
      }
      window.localStorage.setItem(targetKey, content);
      if (targetLanguage === language) setCode(content);
    },
    [problemId, language],
  );

  return { code, setCode, clear, seed };
}
