import { useCallback, useState } from "react";

import { createDraft, getSubmission } from "@/api/submissions";
import type {
  Language,
  SubmissionDetail,
  SubmissionDraft,
  SubmissionMode,
} from "@/api/types";

function sidKey(problemId: number) {
  return `easycode:draft_sid:${problemId}`;
}

export interface DraftState {
  submissionId: string;
  mode: SubmissionMode;
  modeLimitSec: number | null;
  language: Language;
}

export function useSubmissionDraft(problemId: number) {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [creating, setCreating] = useState(false);

  /**
   * 优先复用 localStorage 里的 draft id；若仍是 draft 就续写；否则新建。
   */
  const startOrResume = useCallback(
    async (mode: SubmissionMode, modeLimitSec: number | null, language: Language = "python") => {
      setCreating(true);
      try {
        const stored = window.localStorage.getItem(sidKey(problemId));
        if (stored) {
          try {
            const existing = await getSubmission(stored);
            // 续写旧 draft 需模式与语言都一致：换了语言就该新建，避免拿
            // Python 草稿续写 JS。
            if (
              existing.status === "draft" &&
              existing.mode === mode &&
              existing.language === language
            ) {
              setDraft({
                submissionId: existing.id,
                mode: existing.mode,
                modeLimitSec: existing.mode_limit_sec,
                language: existing.language,
              });
              return existing.id;
            }
          } catch {
            // 旧 id 失效，落到新建分支
          }
        }
        const fresh: SubmissionDraft = await createDraft(problemId, mode, modeLimitSec, language);
        window.localStorage.setItem(sidKey(problemId), fresh.id);
        setDraft({
          submissionId: fresh.id,
          mode: fresh.mode,
          modeLimitSec: fresh.mode_limit_sec,
          language: fresh.language,
        });
        return fresh.id;
      } finally {
        setCreating(false);
      }
    },
    [problemId],
  );

  /** 重置：弃用当前 draft，新建一个（不调后端删除，后端有 7 天清理） */
  const reset = useCallback(
    async (mode: SubmissionMode, modeLimitSec: number | null, language: Language = "python") => {
      // 同时清掉旧 sub 的 elapsed 持久化,避免 reset 后还携带旧累计
      const oldSid = window.localStorage.getItem(sidKey(problemId));
      if (oldSid) {
        window.localStorage.removeItem(`easycode:elapsed:${oldSid}`);
      }
      window.localStorage.removeItem(sidKey(problemId));
      setDraft(null);
      const fresh = await createDraft(problemId, mode, modeLimitSec, language);
      window.localStorage.setItem(sidKey(problemId), fresh.id);
      setDraft({
        submissionId: fresh.id,
        mode: fresh.mode,
        modeLimitSec: fresh.mode_limit_sec,
        language: fresh.language,
      });
      return fresh.id;
    },
    [problemId],
  );

  /**
   * 采用一条「已在后端存在且仍是 draft」的会话为当前局——用于 URL 携带 ?sid= 的直达/分享
   * 场景（会话号 URL 化）。直接用记录里的 mode/语言还原，并把 sid 同步进 localStorage，
   * 让后续断点续答、计时持久化都对齐这一局。调用方需先自行校验 status==='draft' 且 problem 匹配。
   */
  const adoptDraft = useCallback(
    (submission: SubmissionDetail) => {
      window.localStorage.setItem(sidKey(problemId), submission.id);
      setDraft({
        submissionId: submission.id,
        mode: submission.mode,
        modeLimitSec: submission.mode_limit_sec,
        language: submission.language,
      });
    },
    [problemId],
  );

  /** 提交完成 / 切题离开时清掉本题的 sid 记录（由调） */
  const clearLocal = useCallback(() => {
    window.localStorage.removeItem(sidKey(problemId));
    setDraft(null);
  }, [problemId]);

  /**
   * "清空新建"用：丢弃本题在途会话——删 sid 及其累计计时（elapsed），但不新建 draft、
   * 不碰后端已提交的历史记录。之后走正常 startOrResume 即从零起一局。
   */
  const discardSession = useCallback(() => {
    const oldSid = window.localStorage.getItem(sidKey(problemId));
    if (oldSid) {
      window.localStorage.removeItem(`easycode:elapsed:${oldSid}`);
    }
    window.localStorage.removeItem(sidKey(problemId));
    setDraft(null);
  }, [problemId]);

  /**
   * 续编续接:把 sid 切到已经在后端创建好的 newSubmissionId,
   * 把继承的 elapsedSec 写入新 sid 的 `easycode:elapsed:{sid}` localStorage,
   * 这样 useTimer 进入新 sub 时能从 elapsedSec 处接着累加(而不是从 0)。
   * 仅用于"提交后 C/D 评级 + untimed"的续编场景,所以模式恒为 untimed。
   */
  const resumeWith = useCallback(
    (newSubmissionId: string, elapsedSec: number, language: Language = "python") => {
      window.localStorage.setItem(sidKey(problemId), newSubmissionId);
      window.localStorage.setItem(
        `easycode:elapsed:${newSubmissionId}`,
        String(Math.max(0, Math.floor(elapsedSec))),
      );
      setDraft({
        submissionId: newSubmissionId,
        mode: "untimed",
        modeLimitSec: null,
        language, // 续编沿用上一轮语言
      });
    },
    [problemId],
  );

  return {
    draft,
    creating,
    startOrResume,
    reset,
    clearLocal,
    discardSession,
    resumeWith,
    adoptDraft,
  };
}
