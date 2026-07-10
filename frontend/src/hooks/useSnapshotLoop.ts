import { useCallback, useEffect, useRef, useState } from "react";

import { postSnapshots } from "@/api/submissions";
import type { SnapshotIn } from "@/api/types";
import { sha1Hex12 } from "@/lib/sha1";

const RETRY_BACKOFFS_MS = [5_000, 15_000, 45_000];
const SNAPSHOT_INTERVAL_MS = 30_000;
const SNAPSHOT_INTERVAL_SEC = 30;

interface Args {
  submissionId: string | null;
  getCode: () => string;
  /**
   * 返回当前 sub 累计的活跃秒数(useTimer 的 elapsedSec)。
   * 快照的 t_offset_sec 直接从这里对齐,确保 LLM 看到的时间轴 = 用户实际练习时长,
   * 而不是纯墙钟差(否则切走 tab 期间会出现"凭空跳了几分钟的 t_offset",但 code 没变)。
   */
  getElapsedSec: () => number;
  active: boolean;
  /**
   * 续编场景:旧 submission 的快照已复制到新 sub,marker 帧占用了 t = tOffsetBase。
   * 新会话的快照只在 t > tOffsetBase 才能被接受,这里跳过对齐 ≤ 它的所有帧。
   */
  tOffsetBase?: number;
}

interface State {
  accepted: number;
  pending: number;
  lastError: string | null;
}

export function alignFinalSnapshotOffset(elapsedSec: number, tOffsetBase = 0): number {
  const elapsed = Math.max(0, Math.ceil(elapsedSec));
  return Math.max(
    tOffsetBase + SNAPSHOT_INTERVAL_SEC,
    SNAPSHOT_INTERVAL_SEC,
    Math.ceil(elapsed / SNAPSHOT_INTERVAL_SEC) * SNAPSHOT_INTERVAL_SEC,
  );
}

/**
 * 30 秒采集 + 上报循环。
 * - 与上次 hash 相同则不入队
 * - flushQueue 按 5/15/45s 退避重试
 */
export function useSnapshotLoop({
  submissionId,
  getCode,
  getElapsedSec,
  active,
  tOffsetBase = 0,
}: Args) {
  const lastHashRef = useRef<string | null>(null);
  const queueRef = useRef<SnapshotIn[]>([]);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const [state, setState] = useState<State>({
    accepted: 0,
    pending: 0,
    lastError: null,
  });

  const flush = useCallback(async () => {
    if (!submissionId) return;
    if (queueRef.current.length === 0) return;
    const batch = queueRef.current.slice();
    try {
      const result = await postSnapshots(submissionId, batch);
      queueRef.current = queueRef.current.slice(batch.length);
      retryAttemptRef.current = 0;
      setState((s) => ({
        ...s,
        accepted: s.accepted + result.accepted,
        pending: queueRef.current.length,
        lastError: null,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, pending: queueRef.current.length, lastError: msg }));
      const attempt = retryAttemptRef.current;
      if (attempt < RETRY_BACKOFFS_MS.length) {
        const delay = RETRY_BACKOFFS_MS[attempt];
        retryAttemptRef.current = attempt + 1;
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          void flush();
        }, delay);
      }
    }
  }, [submissionId]);

  // submissionId 切换(例如续编创建了新 sub)时重置 last hash + 队列,
  // 否则新会话的第一帧可能因为 hash 与旧会话最后一帧一致而被跳过。
  useEffect(() => {
    lastHashRef.current = null;
    queueRef.current = [];
    retryAttemptRef.current = 0;
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setState({ accepted: 0, pending: 0, lastError: null });
  }, [submissionId]);

  useEffect(() => {
    if (!active || !submissionId) return;
    const id = window.setInterval(async () => {
      const t = getElapsedSec();
      const tAligned = Math.round(t / SNAPSHOT_INTERVAL_SEC) * SNAPSHOT_INTERVAL_SEC;
      if (tAligned <= 0) return;
      // 续编场景:复制过来的旧快照 + marker 帧已占用 t ≤ tOffsetBase,新会话从下一格起跳。
      if (tAligned <= tOffsetBase) return;

      const code = getCode();
      const hash = await sha1Hex12(code);
      if (hash === lastHashRef.current) return;

      // 避免 t_offset 与已发送或队列里的重复
      if (queueRef.current.some((s) => s.t_offset_sec === tAligned)) return;

      queueRef.current.push({
        t_offset_sec: tAligned,
        code,
        code_hash: hash,
        client_ts: new Date().toISOString(),
      });
      lastHashRef.current = hash;
      setState((s) => ({ ...s, pending: queueRef.current.length }));
      void flush();
    }, SNAPSHOT_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [active, submissionId, getElapsedSec, getCode, flush, tOffsetBase]);

  // finalize 前主动把当前快照采一帧并 flush 队列,避免最后 0-30s 的窗口丢失。
  const flushNow = useCallback(async () => {
    if (!submissionId) return;
    const t = getElapsedSec();
    const tAligned = alignFinalSnapshotOffset(t, tOffsetBase);
    if (tAligned > 0 && tAligned > tOffsetBase) {
      const code = getCode();
      const hash = await sha1Hex12(code);
      const dupInQueue = queueRef.current.some((s) => s.t_offset_sec === tAligned);
      if (hash !== lastHashRef.current && !dupInQueue) {
        queueRef.current.push({
          t_offset_sec: tAligned,
          code,
          code_hash: hash,
          client_ts: new Date().toISOString(),
        });
        lastHashRef.current = hash;
        setState((s) => ({ ...s, pending: queueRef.current.length }));
      }
    }
    await flush();
  }, [submissionId, getElapsedSec, getCode, flush, tOffsetBase]);

  return { ...state, flush: flushNow };
}
