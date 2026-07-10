import { useEffect, useState } from "react";

import type { Language, SubmissionMode } from "@/api/types";
import { getIoFormatDefault, type IoFormat } from "@/hooks/useIoFormat";

import { Button } from "./Button";
import styles from "./ModeSelectForm.module.css";

interface Props {
  problemTitle: string;
  onConfirm: (
    mode: SubmissionMode,
    limitSec: number | null,
    language: Language,
    ioFormat: IoFormat,
  ) => void;
  /** 正在创建本局草稿时禁用「开始」，避免重复提交。 */
  creating?: boolean;
  /** 该题各语言的 LeetCode 模板（来自 /tests）；用于提示所选语言是否支持 LeetCode 模式。 */
  templates?: Record<string, string>;
  /**
   * 检测到"上次未完成、未提交且用户真正改动过"的代码草稿时，其所在语言；否则 null。
   * 非 null 时准备页顶部显示断点续答横幅，且下方模式/语言/IO 全部灰掉锁定——必须先在
   * 横幅二选一：要么「继续未完成」直接恢复，要么「清空新建」清空并解锁下方重新配置。
   */
  residualLanguage?: Language | null;
  /** 「继续未完成」：原样恢复上次会话（模式/时长/语言由页面按在途会话决定）。 */
  onContinueResidual?: () => void;
  /** 在途会话元数据仍在拉取 → 暂时禁用「继续」，确保按真实模式恢复。 */
  continuePending?: boolean;
  /** 「清空新建」：清掉本题所有语言的代码草稿 + 在途会话计时（保留历史记录），并解锁下方表单。 */
  onClearResidual?: () => void;
}

const TIMED_PRESETS = [
  { label: "10 分钟", sec: 10 * 60 },
  { label: "15 分钟", sec: 15 * 60 },
  { label: "20 分钟", sec: 20 * 60 },
  { label: "30 分钟", sec: 30 * 60 },
];

/**
 * 开题面板。
 *
 * 准备阶段右半屏直接渲染这张卡片让用户选模式/时长/语言，选完点「开始」进入答题。
 */
export function ModeSelectForm({
  problemTitle,
  onConfirm,
  creating = false,
  templates,
  residualLanguage = null,
  onContinueResidual,
  continuePending = false,
  onClearResidual,
}: Props) {
  const [mode, setMode] = useState<SubmissionMode>("untimed");
  const [limit, setLimit] = useState<number>(15 * 60);
  const [language, setLanguage] = useState<Language>(residualLanguage ?? "python");
  const [ioFormat, setIoFormat] = useState<IoFormat>(getIoFormatDefault);
  // 已选择「新建一局」但尚未提交：解锁下方表单，但草稿仍保留、横幅仍在，
  // 「继续作答」随时可反悔跳回。真正清空延迟到点「开始作答」那一刻。
  const [newGame, setNewGame] = useState(false);

  // 残留草稿的语言若晚于首帧到达（/tests 异步加载），把语言选择同步过去，
  // 让 IO 提示与「继续作答」一致。只在残留语言变化时触发，不覆盖用户手动改选。
  useEffect(() => {
    if (residualLanguage) setLanguage(residualLanguage);
  }, [residualLanguage]);

  // 切题 / 残留被清空后，重置回"锁定"初态（下一题的残留应重新走二选一）。
  useEffect(() => {
    setNewGame(false);
  }, [residualLanguage]);

  // 所选语言是否有 LeetCode 模板；无则 LeetCode 模式会回退到 ACM 空白编辑器。
  const leetcodeAvailable = Boolean(templates?.[language]?.trim());
  const limitFor = (m: SubmissionMode) => (m === "timed" ? limit : null);

  // 有残留且还没选「新建一局」→ 下方表单锁定；选了「新建一局」或本就无残留 → 解锁并露出「开始作答」。
  const locked = !!residualLanguage && !newGame;
  const showConfirm = !residualLanguage || newGame;

  // 提交新一局：若此刻仍存在残留（走的是「新建一局」路径），先清空草稿+在途会话再开新局。
  const handleConfirmFresh = () => {
    if (residualLanguage) onClearResidual?.();
    onConfirm(mode, limitFor(mode), language, ioFormat);
  };

  return (
    <section className={styles.root}>
      <div className={styles.card}>
        <div className="kicker">准备本局</div>
        <h2 className={styles.title}>开始作答</h2>
        <p className={styles.subtitle}>{problemTitle}</p>

        {residualLanguage && (
          <div className={styles.residual}>
            <p className={styles.residualText}>
              你这道题还有<strong>未写完的草稿</strong>，请选择是继续作答，还是新建一局？
            </p>
            <div className={styles.residualActions}>
              <Button
                variant="primary"
                size="md"
                onClick={() => onContinueResidual?.()}
                disabled={creating || continuePending}
              >
                {continuePending ? "读取中…" : "继续作答"}
              </Button>
              <Button
                variant="secondary"
                size="md"
                className={newGame ? styles.residualGhostOn : undefined}
                onClick={() => setNewGame(true)}
                disabled={creating}
              >
                新建一局
              </Button>
            </div>
          </div>
        )}

        <fieldset className={styles.group} disabled={locked}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>模式</span>
          <div className={styles.modeRow}>
            <button
              type="button"
              className={`${styles.modeBtn} ${mode === "untimed" ? styles.modeBtnOn : ""}`}
              onClick={() => setMode("untimed")}
            >
              <span className={styles.modeLabel}>正计时</span>
              <span className={styles.modeHint}>不限时，专注思考</span>
            </button>
            <button
              type="button"
              className={`${styles.modeBtn} ${mode === "timed" ? styles.modeBtnOn : ""}`}
              onClick={() => setMode("timed")}
            >
              <span className={styles.modeLabel}>倒计时</span>
              <span className={styles.modeHint}>限时模拟</span>
            </button>
          </div>
        </div>

        {mode === "timed" && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>时长</span>
            <div className={styles.presets}>
              {TIMED_PRESETS.map((p) => (
                <button
                  key={p.sec}
                  type="button"
                  className={`${styles.preset} ${limit === p.sec ? styles.presetOn : ""}`}
                  onClick={() => setLimit(p.sec)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.field}>
          <span className={styles.fieldLabel}>输入输出格式</span>
          <div className={styles.presets}>
            <button
              type="button"
              className={`${styles.preset} ${ioFormat === "leetcode" ? styles.presetOn : ""}`}
              onClick={() => setIoFormat("leetcode")}
            >
              LeetCode 函数
            </button>
            <button
              type="button"
              className={`${styles.preset} ${ioFormat === "acm" ? styles.presetOn : ""}`}
              onClick={() => setIoFormat("acm")}
            >
              ACM 输入输出
            </button>
          </div>
          <p className={styles.langHint}>
            {ioFormat === "acm"
              ? "编辑器留空，你自己读取标准输入、用 print 输出。"
              : leetcodeAvailable
                ? "编辑器预填函数框架和输入输出外壳，你只写函数体。"
                : "该题暂无 LeetCode 模板，将回退为 ACM 空白编辑器。"}
          </p>
        </div>
        </fieldset>

        {showConfirm && (
          <Button
            variant="primary"
            size="lg"
            block
            className={styles.confirm}
            onClick={handleConfirmFresh}
            disabled={creating}
          >
            {creating ? "正在准备…" : "开始作答 →"}
          </Button>
        )}

        <p className={styles.note}>
          题目作答期间，将每 30 秒获取一次代码区快照，系统将在提交后自动分析你的代码作答轨迹。
        </p>
      </div>
    </section>
  );
}
