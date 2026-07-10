import { useCallback, useEffect, useRef, useState } from "react";

import type { SubmissionMode } from "@/api/types";

/**
 * 计时器:只在"当前用户真的在页面上写题"的时间才累加。
 *
 * 设计要点:
 * - 累计模式:elapsedSec = accumulatedSec(过去会话的总和)+ 当前活跃会话内增量
 * - 活跃 = 页面可见(visibilitychange)+ 未冻结(submit 后传 frozen=true)+ 未手动暂停
 * - 持久化:每次状态切换 / visibilitychange / unmount 都把累计值写 localStorage,
 *   key 用 submissionId 隔离;下次进同一 sub 时从 localStorage 读起点
 * - 续编场景:resumeWith 时由 useSubmissionDraft 把继承的 elapsed_sec 写入新 sid 的 key,
 *   useTimer 进来时自然拿到正确起点。
 *
 * 故意不依赖 setInterval 累加值——浏览器后台 tab 会节流 interval,但 Date.now() 是准的。
 * 用 setInterval 仅作"每 500ms 刷一次显示"的触发器;真实增量由 Date.now() 差算。
 */

const STORAGE_PREFIX = "easycode:elapsed:";

function storageKey(submissionId: string | null): string | null {
  return submissionId ? `${STORAGE_PREFIX}${submissionId}` : null;
}

function readStored(submissionId: string | null): number {
  const key = storageKey(submissionId);
  if (!key) return 0;
  const raw = window.localStorage.getItem(key);
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function writeStored(submissionId: string | null, total: number) {
  const key = storageKey(submissionId);
  if (!key) return;
  window.localStorage.setItem(key, String(Math.max(0, Math.floor(total))));
}

interface Args {
  submissionId: string | null;
  mode: SubmissionMode;
  limitSec: number | null;
  /** 提交中 / 评测中 / 已完成 → 冻结,不再累加 */
  frozen: boolean;
}

export function useTimer({ submissionId, mode, limitSec, frozen }: Args) {
  const [accumulatedSec, setAccumulatedSec] = useState(() => readStored(submissionId));
  const accumulatedRef = useRef(accumulatedSec);
  accumulatedRef.current = accumulatedSec;
  const [paused, setPaused] = useState(false);
  // 当前"活跃会话"的起始墙钟时间;null = 不活跃(暂停 / 不可见 / 冻结)
  const activeSinceMsRef = useRef<number | null>(null);
  // 仅用于触发重渲(显示刷新)
  const [, forceTick] = useState(0);

  // submissionId 切换:从对应 localStorage 读起点;旧会话的活跃 delta 在上一轮 effect cleanup 里已合并
  useEffect(() => {
    const next = readStored(submissionId);
    setAccumulatedSec(next);
    accumulatedRef.current = next;
    activeSinceMsRef.current = null;
    setPaused(false);
  }, [submissionId]);

  // 把"当前活跃会话"的 delta 合并进 accumulated 并持久化(用 ref 拿最新值,避免把 accumulated 放进 effect deps)
  const commitActiveSession = useCallback(() => {
    if (activeSinceMsRef.current === null) {
      writeStored(submissionId, accumulatedRef.current);
      return;
    }
    const delta = Math.floor((Date.now() - activeSinceMsRef.current) / 1000);
    activeSinceMsRef.current = null;
    if (delta <= 0) {
      writeStored(submissionId, accumulatedRef.current);
      return;
    }
    const next = accumulatedRef.current + delta;
    accumulatedRef.current = next;
    writeStored(submissionId, next);
    setAccumulatedSec(next);
  }, [submissionId]);

  // 是否应该计时:可见 + 未冻结 + 未手动暂停
  const desiredActive = !frozen && !paused;

  useEffect(() => {
    const enter = () => {
      if (
        !desiredActive ||
        document.visibilityState !== "visible" ||
        activeSinceMsRef.current !== null
      ) {
        return;
      }
      activeSinceMsRef.current = Date.now();
    };

    // 初始进入:尝试 enter
    enter();
    // 500ms 刷一次显示(setInterval 在后台 tab 会被节流,但显示节奏不准没关系,真实增量靠 Date.now())
    const tickId = window.setInterval(() => forceTick((t) => t + 1), 500);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        enter();
      } else {
        commitActiveSession();
      }
      forceTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVis);

    const onUnload = () => {
      // 浏览器关闭 / 刷新前刷一次;visibilitychange→hidden 通常先触发,这里是兜底
      commitActiveSession();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);

    return () => {
      // 卸载或 desiredActive 切换时把当前活跃 delta 合并并写入
      commitActiveSession();
      window.clearInterval(tickId);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, [desiredActive, commitActiveSession]);

  // 当前显示:accumulated + 当前活跃会话的 delta
  const liveDelta =
    activeSinceMsRef.current !== null
      ? Math.floor((Date.now() - activeSinceMsRef.current) / 1000)
      : 0;
  const elapsedSec = accumulatedSec + Math.max(0, liveDelta);

  const remainingSec =
    mode === "timed" && limitSec ? Math.max(0, limitSec - elapsedSec) : null;
  const overdue = mode === "timed" && limitSec ? elapsedSec >= limitSec : false;

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  return { elapsedSec, remainingSec, overdue, paused, togglePause };
}
