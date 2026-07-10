import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type { Language, Rating } from "@/api/types";
import { Button } from "@/components/Button";
import { CodeEditor, type LineDecoration } from "@/components/CodeEditor";
import { useSubmissionSnapshots } from "@/hooks/useSubmissionSnapshots";

import styles from "./SnapshotReplay.module.css";

interface Props {
  submissionId: string;
  /** 最终提交代码（= SubmissionDetail.code）：作为回放的末帧，确保回放收束于真正提交的内容。 */
  finalCode: string;
  /** 最终用时（秒），用于末帧时间标签。 */
  elapsedSec: number;
  language?: Language;
}

interface Frame {
  code: string;
  kind: "code" | "submit_marker";
  rating: Rating | null;
  label: string;
}

/** 长时间线限帧上限：超过则均匀抽样（强制保留首/末 + 所有 marker 帧）。 */
const MAX_FRAMES = 80;
/** 自动播放步进间隔（ms）。 */
const PLAY_INTERVAL_MS = 600;
/** diff 行数保护：超大文件跳过 LCS，避免卡 UI（练习代码远低于此）。 */
const DIFF_LINE_GUARD = 1200;

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/** 帧数超上限时均匀抽样，强制保留首帧、末帧与所有 marker 帧。 */
function subsample(frames: Frame[], max: number): Frame[] {
  if (frames.length <= max) return frames;
  const keep = new Set<number>([0, frames.length - 1]);
  frames.forEach((f, i) => {
    if (f.kind === "submit_marker") keep.add(i);
  });
  const budget = max - keep.size;
  if (budget > 0) {
    const step = (frames.length - 1) / (budget + 1);
    for (let k = 1; k <= budget; k++) keep.add(Math.round(k * step));
  }
  return Array.from(keep)
    .sort((a, b) => a - b)
    .map((i) => frames[i]);
}

/**
 * LCS 行 diff：返回当前帧中"新增 / 变化行"的整行装饰范围。
 * - 纯插入（无对应删除）→ kind "add"
 * - 与删除交织的插入段 → kind "change"
 * 单编辑器只显示当前帧，故纯删除行无法内联展示（被并入相邻 change 段的语义）。
 */
function diffLines(prevText: string, curText: string): LineDecoration[] {
  const a = prevText.split("\n");
  const b = curText.split("\n");
  const n = a.length;
  const m = b.length;
  if (n > DIFF_LINE_GUARD || m > DIFF_LINE_GUARD) return [];

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const decos: LineDecoration[] = [];
  let i = 0;
  let j = 0;
  let runStart = -1; // 当前连续插入段在 b 中的起始行（0-based）
  let runHadDeletion = false;
  const flush = (endLineExclusive: number) => {
    if (runStart >= 0) {
      decos.push({
        startLine: runStart + 1,
        endLine: endLineExclusive,
        kind: runHadDeletion ? "change" : "add",
      });
    }
    runStart = -1;
    runHadDeletion = false;
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush(j); // 该匹配行前的插入段收尾（覆盖 b[runStart..j-1] → endLine = j）
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      runHadDeletion = true; // a[i] 被删
      i++;
    } else {
      if (runStart < 0) runStart = j; // b[j] 是新行
      j++;
    }
  }
  while (j < m) {
    if (runStart < 0) runStart = j;
    j++;
  }
  while (i < n) {
    runHadDeletion = true;
    i++;
  }
  flush(m);
  return decos;
}

export function SnapshotReplay({
  submissionId,
  finalCode,
  elapsedSec,
  language,
}: Props) {
  const { data, isLoading, error } = useSubmissionSnapshots(submissionId);

  const frames = useMemo<Frame[]>(() => {
    const snaps = data?.items ?? [];
    const out: Frame[] = snaps.map((s) => ({
      code: s.code,
      kind: s.kind,
      rating: s.rating,
      label: fmtClock(s.t_offset_sec),
    }));
    // 末帧：真正提交的代码（仅当与最后一帧不同，避免重复）。
    const last = out[out.length - 1];
    if (!last || last.code !== finalCode) {
      out.push({
        code: finalCode,
        kind: "code",
        rating: null,
        label: `最终 · ${fmtClock(elapsedSec)}`,
      });
    }
    return subsample(out, MAX_FRAMES);
  }, [data, finalCode, elapsedSec]);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  // 切提交 / 帧集变化：跳到末帧（与现状静态视图一致），停止播放。
  useEffect(() => {
    setIdx(frames.length > 0 ? frames.length - 1 : 0);
    setPlaying(false);
  }, [submissionId, frames.length]);

  // 自动播放：到末帧自动停。
  useEffect(() => {
    if (!playing) return;
    if (idx >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(
      () => setIdx((i) => Math.min(frames.length - 1, i + 1)),
      PLAY_INTERVAL_MS,
    );
    return () => window.clearTimeout(id);
  }, [playing, idx, frames.length]);

  const decorations = useMemo<LineDecoration[]>(() => {
    if (idx <= 0) return []; // 首帧无 baseline，不高亮
    const prev = frames[idx - 1]?.code ?? "";
    const cur = frames[idx]?.code ?? "";
    return diffLines(prev, cur);
  }, [frames, idx]);

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (idx >= frames.length - 1) setIdx(0); // 在末帧按播放 → 从头重放
    setPlaying(true);
  }

  if (isLoading) {
    return <div className={styles.state}>正在加载回放快照……</div>;
  }
  if (error) {
    return <div className={styles.state}>回放快照加载失败。</div>;
  }

  // 不足 2 帧（无真正过程）：退化为纯静态只读编辑器，行为同改造前。
  if (frames.length < 2) {
    return (
      <div className={styles.replay}>
        <CodeEditor
          code={frames[0]?.code ?? finalCode}
          onChange={() => {}}
          language={language}
          readOnly
        />
      </div>
    );
  }

  const current = frames[idx] ?? frames[frames.length - 1];
  const progress =
    frames.length > 1 ? `${(idx / (frames.length - 1)) * 100}%` : "0%";
  const sliderStyle = {
    "--replay-progress": progress,
  } as CSSProperties & Record<"--replay-progress", string>;

  return (
    <div className={styles.replay} data-qa="snapshot-replay">
      <div className={styles.controls}>
        <div className={styles.row}>
          <Button
            variant="secondary"
            size="sm"
            className={styles.playBtn}
            onClick={togglePlay}
          >
            {playing ? "暂停" : "播放"}
          </Button>
          <input
            type="range"
            className={styles.slider}
            style={sliderStyle}
            min={0}
            max={frames.length - 1}
            step={1}
            value={idx}
            onChange={(e) => {
              setPlaying(false);
              setIdx(Number(e.target.value));
            }}
          />
          <span className={`tnum ${styles.counter}`}>
            {idx + 1} / {frames.length}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.frameLabel}>{current.label}</span>
          {current.kind === "submit_marker" && (
            <span className={styles.marker}>
              上次提交
              {current.rating ? ` · 评级 ${current.rating}` : ""}
            </span>
          )}
        </div>
      </div>
      <CodeEditor
        code={current.code}
        onChange={() => {}}
        language={language}
        readOnly
        decorations={decorations}
      />
    </div>
  );
}
