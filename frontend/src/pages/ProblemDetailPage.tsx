import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { continueSubmission, getSubmission } from "@/api/submissions";
import type {
  Language,
  MasteryAfterUpdate,
  ProblemDetail,
  Rating,
  RunResult,
  SubmissionDetail,
} from "@/api/types";
import { BackBar, labelForPath } from "@/components/BackBar";
import { CodeEditor } from "@/components/CodeEditor";
import { ErrorNotice } from "@/components/ErrorNotice";
import { HelpDrawer } from "@/components/HelpDrawer";
import { ModeSelectForm } from "@/components/ModeSelectForm";
import { ProblemStatement } from "@/components/ProblemStatement";
import { ResizableTwoPane } from "@/components/ResizableTwoPane";
import type { ReviewPhase } from "@/components/ReviewPanel";
import { SessionTopBar } from "@/components/SessionTopBar";
import { showToast } from "@/components/StatusToast";
import { WorkspacePane } from "@/components/WorkspacePane";
import { buildSessionTimeline, type SessionStage } from "@/lib/sessionTimeline";
import { invalidateTrainingAggregates } from "@/lib/queryInvalidation";
import {
  clearProblemDrafts,
  getProblemDraft,
  hasUserEdits,
  useCodeDraft,
} from "@/hooks/useCodeDraft";
import { useFinalizeSubmission } from "@/hooks/useFinalizeSubmission";
import { usePollSubmissionReview } from "@/hooks/usePollSubmissionReview";
import { useMeta } from "@/hooks/useMeta";
import { useProblemDetail } from "@/hooks/useProblemDetail";
import { useProblemList } from "@/hooks/useProblemList";
import { useProblemTests } from "@/hooks/useProblemTests";
import { useReviewSubmission } from "@/hooks/useReviewSubmission";
import { useReviewProgress } from "@/hooks/useReviewProgress";
import { useRunCode } from "@/hooks/useRunCode";
import { useSnapshotLoop } from "@/hooks/useSnapshotLoop";
import { useSubmissionDraft } from "@/hooks/useSubmissionDraft";
import { useTimer } from "@/hooks/useTimer";
import { useSendTutorMessage, useTutorMessages } from "@/hooks/useTutorMessages";
import { useUpdateMastery } from "@/hooks/useUpdateMastery";
import type { AppErrorView } from "@/lib/errors";
import { reviewErrorToAppError, toAppError } from "@/lib/errors";

import styles from "./ProblemDetailPage.module.css";

function scheduleFromMastery(
  result: MasteryAfterUpdate,
  previous: SubmissionDetail["review_schedule"],
): SubmissionDetail["review_schedule"] {
  if (
    !result.next_review_at ||
    result.interval_days === null ||
    !result.effective_rating
  ) {
    return previous;
  }
  return {
    next_review_at: result.next_review_at,
    interval_days: result.interval_days,
    generated_from_rating: result.effective_rating,
    prior_interval_days: previous?.prior_interval_days ?? null,
  };
}

export function ProblemDetailPage() {
  const { id } = useParams();
  const problemId = id ? Number(id) : NaN;
  const location = useLocation();
  const navigate = useNavigate();
  // 来源路径：进入 /problem/:id 时若 Link 透传了 state.from，就回到那里；
  // 否则（如直贴 URL、刷新后丢 history state）兜底回题库。
  const fromPath =
    (location.state as { from?: string } | null)?.from ?? "/";
  const fromLabel = labelForPath(fromPath);
  const { data, isLoading, error } = useProblemDetail(problemId);
  const { data: problemList } = useProblemList();
  const { draft, creating, startOrResume, reset, discardSession, resumeWith, adoptDraft } =
    useSubmissionDraft(problemId);
  // 会话号 URL 化：/problem/:id?sid=<submissionId> 直达/分享某一局。
  // 优先级高于 localStorage 自动续答；解析规则见下方 effect。
  const urlSid = useMemo(
    () => new URLSearchParams(location.search).get("sid"),
    [location.search],
  );
  // 当前语言：源自 draft（开题对话框选定，整局固定）；未开题前默认 python。
  // 驱动编辑器语法高亮、代码草稿分键、运行测试门控。
  const language = draft?.language ?? "python";
  const { code, setCode, seed } = useCodeDraft(problemId, language);
  const { data: runtimeMeta } = useMeta();
  // 用户选 LeetCode 模式但该题无授权模板 → 已回退 ACM 空白编辑器，答题区提示一下。
  const [leetcodeFallback, setLeetcodeFallback] = useState(false);

  const codeRef = useRef(code);
  codeRef.current = code;
  const getCode = useCallback(() => codeRef.current, []);

  // === 执行接地：浏览器内 Pyodide 跑用例用于即时反馈；
  // submit 时后端会按同一测试套件复跑，并以服务端结果作为评测 ground truth。===
  const tests = useProblemTests(problemId);
  const runnerEnabled = runtimeMeta?.executor === "pyodide";
  // 题有 tests 且执行器开启 → 渲染「运行测试」按钮（showRunTest）；执行接地由 Pyodide
  // 提供（仅 Python，也是现在唯一语言）。题本就无 tests → 整体不渲染。
  const showRunTest = runnerEnabled && !!tests.data?.has_tests;
  const canRunTest = showRunTest && language === "python";
  const {
    phase: runPhase,
    result: runResult,
    error: runError,
    run: runCode,
    reset: resetRun,
  } = useRunCode(problemId);
  const runBusy = runPhase === "loading_runtime" || runPhase === "running";
  const handleRunTest = useCallback(() => {
    void runCode(getCode());
  }, [runCode, getCode]);
  const handleCodeChange = useCallback(
    (next: string) => {
      setCode(next);
      if (runPhase !== "idle") {
        resetRun();
      }
    },
    [runPhase, resetRun, setCode],
  );

  // === 断点续答：准备页检测"上次没写完、也没提交、且真正改动过"的代码草稿 ===
  // nonce 用于「清空新建」后强制重算（localStorage 非响应式）。只在准备阶段（无 draft）生效。
  const [residualNonce, setResidualNonce] = useState(0);
  const supportedLanguages = data?.supported_languages ?? ["python"];
  const problemTemplates = tests.data?.templates;

  // 在途会话（stored sid → 后端 draft）：给「继续未完成」原样还原上次的 mode/时长/语言。
  const storedSid = useMemo(
    () =>
      draft || typeof window === "undefined" || urlSid
        ? // urlSid 在场时屏蔽 localStorage 续答路径：以 URL 指定的会话为准，
          // 避免两个真相来源（URL vs localStorage）同时驱动准备阶段。
          null
        : window.localStorage.getItem(`easycode:draft_sid:${problemId}`),
    [problemId, draft, residualNonce, urlSid],
  );
  const resumableQuery = useQuery({
    queryKey: ["resumable-draft", problemId, storedSid],
    enabled: !!storedSid,
    queryFn: () => getSubmission(storedSid as string),
    retry: false,
    staleTime: 0,
  });
  const resumable =
    resumableQuery.data?.status === "draft" ? resumableQuery.data : null;
  // storedSid 指向的会话「已确认非 draft」（已提交 / 评测中 / 评测失败）：这份答案已交，
  // 不该再续答。仅在查询成功且状态明确时置真；加载中 / 拉取失败都不算（保守，避免误清）。
  const isStoredSessionSubmitted =
    !!storedSid && resumableQuery.isSuccess && resumableQuery.data?.status !== "draft";

  const residualLanguage = useMemo<Language | null>(() => {
    if (draft) return null;
    // 有在途 sid 时，必须先确认它仍是可续的 draft，才谈得上「继续作答」：
    // 加载中 / 已提交 / 拉取失败 → resumable 为 null → 一律不显示横幅（清理交给下方 effect），
    // 从而避免"已提交却还提示继续"以及加载期的横幅闪现。
    if (storedSid && !resumable) return null;
    // 优先按在途会话的语言判定，其余语言兜底。
    const preferred = resumable?.language;
    const langs = preferred
      ? [preferred, ...supportedLanguages.filter((l) => l !== preferred)]
      : supportedLanguages;
    for (const lang of langs) {
      if (hasUserEdits(getProblemDraft(problemId, lang), problemTemplates?.[lang])) {
        return lang;
      }
    }
    return null;
    // supportedLanguages 每次渲染新数组，用其内容做 key 稳定依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    problemId,
    draft,
    storedSid,
    resumable,
    supportedLanguages.join(","),
    problemTemplates,
    residualNonce,
  ]);

  // 有 sid 但会话元数据仍在拉取时，暂时禁用「继续」——确保按上次真实模式恢复，而非默认。
  const continuePending = !!storedSid && resumableQuery.isLoading;

  const handleContinueResidual = useCallback(() => {
    if (!residualLanguage) return;
    setLeetcodeFallback(false);
    void startOrResume(
      resumable?.mode ?? "untimed",
      resumable?.mode_limit_sec ?? null,
      residualLanguage,
    );
  }, [residualLanguage, resumable, startOrResume]);

  const handleClearResidual = useCallback(() => {
    clearProblemDrafts(problemId, supportedLanguages);
    setCode("");
    discardSession();
    resetRun();
    setResidualNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId, supportedLanguages.join(","), setCode, discardSession, resetRun]);

  // 准备阶段清理"不该再续答的在途会话"，让再进来是干净的新一局。两种情形：
  //  1) storedSid 指向的答案已提交/评测中/评测失败（isStoredSessionSubmitted）——答案已交，
  //     提交的代码也已存后端，清掉本地代码草稿 + sid + 计时不丢数据。
  //  2) 仍是 draft，但用户从未改过任何语言代码（空会话，residualLanguage === null）——这种
  //     "开了一局却什么都没做"的会话若留着，下次点「开始作答」会被 startOrResume 静默续用，
  //     连累计计时一起带回（表现为"返回再进计时器没归零"）。
  // 此刻在准备阶段（draft 为空），useTimer 休眠（submissionId=null），不会回写 elapsed，清理
  // 安全。有真实改动、且仍是 draft 的在途会话不受影响，仍由断点续答横幅接管（继续/清空）。
  useEffect(() => {
    if (draft) return;
    const emptyDraft = !!resumable && residualLanguage === null;
    if (isStoredSessionSubmitted || emptyDraft) {
      clearProblemDrafts(problemId, supportedLanguages);
      discardSession();
      resetRun();
      setResidualNonce((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft,
    isStoredSessionSubmitted,
    resumable,
    residualLanguage,
    problemId,
    supportedLanguages.join(","),
    discardSession,
    resetRun,
  ]);

  // === 会话号 URL 化：解析 /problem/:id?sid= ===
  // 规则（与用户拍板一致）：
  //  · 仍是 draft 且属于本题 → 采用为当前局（adoptDraft），地址栏 sid 保留；
  //  · 已 finalize（submitted / reviewing / review_failed）→ 跳该局的历史回放；
  //  · 不存在 / 拉取失败 / 题号不符 → 抹掉 sid，退回正常流程（localStorage 续答或选模式）。
  const urlSidQuery = useQuery({
    queryKey: ["url-sid", problemId, urlSid],
    enabled: !!urlSid && !draft,
    queryFn: () => getSubmission(urlSid as string),
    retry: false,
    staleTime: 0,
  });
  const urlSidHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlSid || draft) return;
    if (urlSidQuery.isLoading) return; // 仍在拉取，先不动
    if (urlSidHandledRef.current === urlSid) return; // 同一 sid 已处理，避免重复导航

    const sub = urlSidQuery.data;
    urlSidHandledRef.current = urlSid;
    if (urlSidQuery.isError || !sub || sub.problem_id !== problemId) {
      // 无效 / 不属于本题：抹掉 sid，回到干净的本题 URL（保留来源 state 以便返回）。
      navigate(`/problem/${problemId}`, { replace: true, state: location.state });
      return;
    }
    if (sub.status === "draft") {
      adoptDraft(sub);
      return;
    }
    // 已提交/评测中/评测失败：这一局已交。在题目页内重建"本局复盘"结算视图，让
    // /problem/:id?sid= 成为可回访的结算地址（回放 / 复习计划页的「回到题目」回到此处）。
    // 不写 localStorage、不新建 draft —— 纯只读回访，计时器与快照都保持休眠。
    setRecapSubmission(sub);
    if (!sub.reviewed_at) {
      // 仍在后台评测：接入与提交主流程相同的轮询，reviewed_at 落值即出结果。
      setSubmitState("reviewing");
      setReviewingStartMs(Date.now());
      setPollingId(sub.id);
    } else if (sub.status === "submitted" && sub.review && !sub.review.error) {
      setFinalizedSubmission(sub);
      setSubmitState("done");
    } else {
      // 评测失败 / 降级：与本地提交失败同样呈现"评测可重试"。
      setFinalizedSubmission(sub);
      setSubmitState("error");
      setFinalizeError(
        reviewErrorToAppError(
          sub.review?.error_code ?? sub.review_last_error_code,
          sub.review?.error,
        ),
      );
    }
  }, [
    urlSid,
    draft,
    urlSidQuery.isLoading,
    urlSidQuery.isError,
    urlSidQuery.data,
    problemId,
    navigate,
    adoptDraft,
    location.state,
  ]);

  // 会话建立/切换后把当前局的 sid 回写地址栏（新建、localStorage 续答、reset、续编换号都经此）。
  // replace 避免污染后退栈；draft.submissionId 与 urlSid 一致时不重复导航（含 adoptDraft 后）。
  useEffect(() => {
    if (!draft) return;
    if (urlSid === draft.submissionId) return;
    navigate(`/problem/${problemId}?sid=${encodeURIComponent(draft.submissionId)}`, {
      replace: true,
      state: location.state,
    });
  }, [draft, problemId, urlSid, navigate, location.state]);

  // === 状态机 ===
  const qc = useQueryClient();
  const [submitState, setSubmitState] = useState<ReviewPhase>("idle");
  const [finalizedSubmission, setFinalizedSubmission] =
    useState<SubmissionDetail | null>(null);
  // 结算回访（会话号 URL 化）：直达/分享 /problem/:id?sid=<已交会话> 而本地又没有内存 draft
  // 时（如从回放 / 复习计划页点「回到题目」返回），在本页重建"本局复盘"结算视图，而不是
  // 跳去历史页。非空即表示当前处于"只读回访某一局结算"状态，不是进行中的作答会话。
  const [recapSubmission, setRecapSubmission] =
    useState<SubmissionDetail | null>(null);
  const [finalizeError, setFinalizeError] = useState<AppErrorView | null>(null);
  const [submitRuntimeMessage, setSubmitRuntimeMessage] = useState<string | null>(null);
  // 异步评测：finalize/retry 返回 reviewing 后轮询此 id，直到 reviewed_at 落值。
  const [pollingId, setPollingId] = useState<string | null>(null);

  // reviewing 阶段已用秒（驱动按钮 + 骨架文案）
  const [reviewingStartMs, setReviewingStartMs] = useState<number | null>(null);
  const [reviewingElapsedSec, setReviewingElapsedSec] = useState(0);

  // 续编:对 C/D 评级 + untimed 模式,用户敲键瞬间自动开新 sub。
  // tOffsetBase = 上次提交那刻的 marker t_offset(后端返回);新会话快照从 base + 30 起跳。
  const [tOffsetBase, setTOffsetBase] = useState(0);
  const continuingRef = useRef(false);

  // === 求助 Drawer 状态（声明在这里方便切题 reset effect 引用） ===
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpErr, setHelpErr] = useState<AppErrorView | null>(null);
  const [pendingHelpQuestion, setPendingHelpQuestion] = useState<string | null>(null);
  const [streamingHelpText, setStreamingHelpText] = useState("");
  const [helpStreamFallback, setHelpStreamFallback] = useState(false);

  // === 计时器 ===
  // 冻结条件:submitting / reviewing / done。useTimer 还会自己处理 visibility / paused / submissionId 切换,
  // 跨会话累计通过 localStorage(key=sid)持久化,所以页面关闭再开不会"补"墙钟时间。
  const isTimerFrozen =
    submitState === "submitting" ||
    submitState === "reviewing" ||
    submitState === "done";
  const timer = useTimer({
    submissionId: draft?.submissionId ?? null,
    mode: draft?.mode ?? "untimed",
    limitSec: draft?.modeLimitSec ?? null,
    frozen: isTimerFrozen,
  });

  // 切题时重置一切。
  // 只在 problemId **真正变化**时重置（题库内 /problem/1 → /problem/2 复用同一组件、不卸载）。
  // 关键：初次挂载 / StrictMode 重跑 / 无关重渲染都不能进这里——否则会清掉 URL ?sid= 在别的
  // effect 里刚重建的 recap 结算态（比较 problemId 值而非"是否首跑"，对 StrictMode 双调用安全）。
  const prevProblemIdRef = useRef(problemId);
  useEffect(() => {
    if (prevProblemIdRef.current === problemId) return;
    prevProblemIdRef.current = problemId;
    setLeetcodeFallback(false);
    setSubmitState("idle");
    setFinalizedSubmission(null);
    setRecapSubmission(null);
    setFinalizeError(null);
    setSubmitRuntimeMessage(null);
    setReviewingStartMs(null);
    setPollingId(null);
    setTOffsetBase(0);
    continuingRef.current = false;
    setHelpOpen(false);
    setHelpErr(null);
    setPendingHelpQuestion(null);
    setStreamingHelpText("");
    setHelpStreamFallback(false);
  }, [problemId]);
  useEffect(() => {
    if (submitState !== "reviewing" || reviewingStartMs === null) {
      setReviewingElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => {
      setReviewingElapsedSec(Math.floor((Date.now() - reviewingStartMs) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [submitState, reviewingStartMs]);

  // snapshot loop:done/error 后停止
  // getElapsedSec 用 ref 让快照逻辑共享 useTimer 的"累计活跃时间",
  // 这样快照 t_offset_sec 严格等于用户实际练习时长,LLM 看到的时间轴不会被切 tab 的墙钟差污染。
  const elapsedRef = useRef(timer.elapsedSec);
  elapsedRef.current = timer.elapsedSec;
  const getElapsedSec = useCallback(() => elapsedRef.current, []);
  const snapshotActive =
    !!draft && !timer.paused && submitState !== "done" && submitState !== "submitting" && submitState !== "reviewing";
  const snap = useSnapshotLoop({
    submissionId: draft?.submissionId ?? null,
    getCode,
    getElapsedSec,
    active: snapshotActive,
    tOffsetBase,
  });

  // === mutations ===
  const finalizeMut = useFinalizeSubmission();
  const reviewMut = useReviewSubmission();
  const masteryMut = useUpdateMastery(problemId);
  const tutorMessages = useTutorMessages(draft?.submissionId ?? null, helpOpen);
  const helpMut = useSendTutorMessage();

  // === 异步评测轮询===
  // finalize/retry 返回 reviewing 后开始轮询 GET /submissions/{id}，reviewed_at 落值即终态。
  const pollEnabled = submitState === "reviewing" && pollingId !== null;
  const reviewPoll = usePollSubmissionReview(pollingId, pollEnabled);
  const reviewProgress = useReviewProgress(pollingId, pollEnabled);

  useEffect(() => {
    if (!pollEnabled) return;
    const detail = reviewPoll.data;
    if (!detail || !detail.reviewed_at) return; // 还在后台评测
    // 终态：停轮询、落地结果。
    setPollingId(null);
    setFinalizedSubmission(detail);
    if (detail.status === "submitted" && detail.review && !detail.review.error) {
      setSubmitState("done");
      // finalize 已不带评级，评级缓存同步挪到这里（避免徽标闪旧值）。
      const auto = (detail.review.rating as Rating | null) ?? null;
      const user = detail.user_rating_override;
      qc.setQueryData<ProblemDetail | undefined>(["problem", problemId], (prev) =>
        prev
          ? {
              ...prev,
              mastery: {
                auto_rating: auto,
                user_rating: user,
                effective_rating: (user ?? auto) as Rating | null,
              },
              last_submission_id: detail.id,
            }
          : prev,
      );
      qc.invalidateQueries({ queryKey: ["problem", problemId] });
      qc.invalidateQueries({ queryKey: ["submissions", problemId] });
      invalidateTrainingAggregates(qc);
    } else {
      // 降级 / review_failed：独立标识，不当成正常评测的 C。
      setSubmitState("error");
      setFinalizeError(
        reviewErrorToAppError(detail.review?.error_code, detail.review?.error),
      );
    }
  }, [pollEnabled, reviewPoll.data, problemId, qc]);

  useEffect(() => {
    if (!pollEnabled || !reviewPoll.error) return;
    setPollingId(null);
    setSubmitState("error");
    setFinalizeError(
      toAppError(reviewPoll.error, {
        title: "评测结果暂时没有刷新出来",
        message: "提交已经保留，可以稍后重试评测，或先打开设置诊断确认后端状态。",
      }),
    );
  }, [pollEnabled, reviewPoll.error]);

  // === 提交主流程 ===
  const handleSubmit = useCallback(async () => {
    if (!draft?.submissionId) return;
    if (
      submitState === "submitting" ||
      submitState === "reviewing" ||
      submitState === "done"
    ) {
      return;
    }
    setSubmitState("submitting");
    setFinalizeError(null);
    setFinalizedSubmission(null);
    setSubmitRuntimeMessage(null);

    // 先把当前编辑器内容补一帧并把队列里没发完的快照 flush 出去,
    // 避免最后 0-30s 窗口的快照丢给 LLM。flush 内部已捕获异常,不会阻塞 finalize。
    await snap.flush();

    //  run-then-review：submit 时先在浏览器跑一次全量用例（include_hidden）给用户即时反馈；
    // 后端 finalize 会复跑并覆盖为权威结果。canRunTest 为假（EXECUTOR=none / 无边车）
    // 或运行失败（rr=null，如 Pyodide 加载失败）→ 不带预跑结果，后端按自身配置降级，绝不阻塞提交。
    let testResults: RunResult | null = null;
    if (canRunTest) {
      setSubmitRuntimeMessage(
        "正在准备浏览器内的 Python 运行环境并运行可用测试；这一步在浏览器内完成，不是在等待服务端或 AI 评测。",
      );
      testResults = await runCode(codeRef.current, true);
      setSubmitRuntimeMessage(null);
    }

    // 200ms 视觉过渡后切到 reviewing 并开始计时
    const transitionTimer = window.setTimeout(() => {
      setSubmitState("reviewing");
      setReviewingStartMs(Date.now());
    }, 200);

    finalizeMut.mutate(
      {
        submissionId: draft.submissionId,
        code: codeRef.current,
        elapsedSec: timer.elapsedSec,
        testResults,
      },
      {
        onSuccess: (detail) => {
          window.clearTimeout(transitionTimer);
          setSubmitRuntimeMessage(null);
          // finalize 立即返回 status=reviewing、reviewed_at=null，评测在后台跑。
          // 进入轮询等结果（reviewPoll 的 useEffect 落终态）。兜底：若 finalize 比 200ms
          // 过渡计时器更快返回，这里确保已切到 reviewing 并起计时。
          // 先把 reviewing 详情写进 ["submission", id] 缓存，轮询从 reviewed_at=null 起步。
          qc.setQueryData<SubmissionDetail>(["submission", detail.id], detail);
          setSubmitState("reviewing");
          setReviewingStartMs((prev) => prev ?? Date.now());
          setPollingId(detail.id);
          // 保留 draft state(Timer / 评测面板需要的 elapsed_sec 等)，编辑器进入 readOnly。
          // 续编流(C/D)由 onAttemptReadOnlyEdit 接管。不 clearLocal：startOrResume 会自动
          // 跳过已 finalize 的旧 sid。
        },
        onError: (err) => {
          window.clearTimeout(transitionTimer);
          setSubmitRuntimeMessage(null);
          setSubmitState("error");
          setFinalizeError(toAppError(err));
        },
      },
    );
  }, [draft?.submissionId, submitState, finalizeMut, timer.elapsedSec, snap, qc, canRunTest, runCode]);

  // === 续编 ===
  // 仅 untimed + C/D 评级允许;A/B 永久锁,timed 提交即结束。
  // effective 优先从 mastery 表读(被 user override 覆盖后立刻生效),fallback 到本次 review.rating。
  const effectiveFinalRating: Rating | null =
    (data?.mastery?.effective_rating ?? null) ||
    finalizedSubmission?.review?.rating ||
    null;
  const canContinue =
    // 只读回访结算（recap）时编辑器里没有那一局的代码，续编会从空白起步，因此不提供
    // 「继续优化」——C/D 回访会转而显示「重新作答」（新开一局，行为正确）。
    !recapSubmission &&
    submitState === "done" &&
    finalizedSubmission?.mode === "untimed" &&
    (effectiveFinalRating === "C" || effectiveFinalRating === "D");

  const handleAttemptReadOnlyEdit = useCallback(async () => {
    if (continuingRef.current) return;
    if (!finalizedSubmission) return;
    // 二次门控,防止状态切换中的竞态
    const effective =
      (data?.mastery?.effective_rating ?? null) ||
      finalizedSubmission.review?.rating ||
      null;
    if (
      finalizedSubmission.mode !== "untimed" ||
      (effective !== "C" && effective !== "D")
    ) {
      return;
    }

    continuingRef.current = true;
    try {
      const resp = await continueSubmission(finalizedSubmission.id);
      // resumeWith 把 sid 切到新 sub 并把继承 elapsed 写入新 sid 的 localStorage,
      // useTimer 重新挂载时自动从这里读起点,显示连续。语言沿用续编出的新 sub（=父语言）。
      resumeWith(resp.submission.id, finalizedSubmission.elapsed_sec, resp.submission.language);
      setTOffsetBase(resp.t_offset_resume);
      setFinalizedSubmission(null);
      setFinalizeError(null);
      setReviewingStartMs(null);
      setPollingId(null);
      setSubmitState("idle");
      resetRun();
    } catch (err) {
      console.error("[continue]", err);
      setSubmitState("error");
      setFinalizeError(
        toAppError(err, {
          title: "续编没有开始",
          message: "当前提交记录已保留，但续编草稿没有创建成功。请稍后重试，或重新作答。",
        }),
      );
    } finally {
      continuingRef.current = false;
    }
  }, [finalizedSubmission, data?.mastery?.effective_rating, resumeWith, resetRun]);

  const handleRestartAfterReview = useCallback(async () => {
    if (!finalizedSubmission) return;
    try {
      await reset(
        finalizedSubmission.mode,
        finalizedSubmission.mode_limit_sec,
        finalizedSubmission.language,
      );
      setSubmitState("idle");
      setFinalizedSubmission(null);
      // 从只读回访「重新作答」→ 已切换为进行中的新会话，退出 recap 状态。
      setRecapSubmission(null);
      setFinalizeError(null);
      setReviewingStartMs(null);
      setPollingId(null);
      setTOffsetBase(0);
      resetRun();
    } catch (err) {
      console.error("[restart]", err);
      setSubmitState("error");
      setFinalizeError(
        toAppError(err, {
          title: "重新作答没有开始",
          message: "当前提交记录已保留，但新草稿没有创建成功。请稍后重试，或回题库重新进入。",
        }),
      );
    }
  }, [finalizedSubmission, reset, resetRun]);

  // === 重试评测 ===
  const handleRetryReview = useCallback(() => {
    const sid = finalizedSubmission?.id ?? draft?.submissionId;
    if (!sid) return;
    setSubmitState("reviewing");
    setReviewingStartMs(Date.now());
    setFinalizeError(null);
    reviewMut.mutate(sid, {
      // retry 同样返回 reviewing；先用 reviewing 详情覆盖 ["submission", sid] 缓存里上次
      // 评测的旧终态（否则轮询读到旧 reviewed_at 会误判已完成），再进入同一套轮询。
      onSuccess: (detail) => {
        qc.setQueryData<SubmissionDetail>(["submission", sid], detail);
        setPollingId(sid);
      },
      onError: (err) => {
        setSubmitState("error");
        setFinalizeError(toAppError(err));
      },
    });
  }, [finalizedSubmission?.id, draft?.submissionId, reviewMut, qc]);

  // === 评级覆盖 ===
  const handlePickRating = useCallback(
    (next: Rating | null) => {
      masteryMut.mutate(
        { userRating: next },
        {
          onSuccess: (result) => {
            setFinalizedSubmission((prev) =>
              prev
                ? {
                    ...prev,
                    user_rating_override: result.user_rating,
                    review_schedule: scheduleFromMastery(
                      result,
                      prev.review_schedule,
                    ),
                  }
                : prev,
            );
            showToast(next ? `已把评级调整为 ${next}` : "已恢复评测原评级");
          },
        },
      );
    },
    [masteryMut],
  );

  // === 求助 Drawer 回调 ===
  const handleOpenHelp = useCallback(() => {
    if (submitState === "submitting" || submitState === "reviewing") return;
    setHelpOpen(true);
    setHelpErr(null);
  }, [submitState]);

  const handleAsk = useCallback(
    (userQuestion: string) => {
      if (!draft?.submissionId) {
        setHelpErr({
          kind: "unknown",
          tone: "warning",
          title: "还没有开始本局",
          message: "请先选择模式开始作答，再请求分层提示。",
          code: "NO_DRAFT",
        });
        return;
      }
      setHelpErr(null);
      setPendingHelpQuestion(userQuestion);
      setStreamingHelpText("");
      setHelpStreamFallback(false);
      helpMut.mutate(
        {
          submissionId: draft.submissionId,
          currentCode: codeRef.current,
          content: userQuestion,
          onDelta: (delta) => {
            setStreamingHelpText((current) => current + delta);
          },
          onStreamFallback: () => {
            setStreamingHelpText("");
            setHelpStreamFallback(true);
          },
        },
        {
          onSuccess: (resp) => {
            setStreamingHelpText(resp.message.content);
            void tutorMessages.refetch();
          },
          onError: (err) =>
            setHelpErr(
              toAppError(err),
            ),
          onSettled: () => {
            setPendingHelpQuestion(null);
            setStreamingHelpText("");
          },
        },
      );
    },
    [draft?.submissionId, helpMut, tutorMessages],
  );

  // === 计算评级展示数据 ===
  const masteryInfo = useMemo(() => {
    // done 后优先用 finalizedSubmission（包含本次 review 写入的 auto_rating）
    // 但 effective_rating 的权威源仍是 mastery 表，所以读 detail.mastery
    const detailMastery = data?.mastery;
    return {
      effective: detailMastery?.effective_rating ?? null,
      user: detailMastery?.user_rating ?? null,
      auto: detailMastery?.auto_rating ?? null,
    };
  }, [data?.mastery]);

  const helpMessages = tutorMessages.data?.messages ?? [];
  const helpCurrentTier = useMemo(() => {
    for (let index = helpMessages.length - 1; index >= 0; index -= 1) {
      if (helpMessages[index].role === "tutor") return helpMessages[index].tier_at;
    }
    return 0;
  }, [helpMessages]);

  const codeReadOnly =
    !draft ||
    submitState === "submitting" ||
    submitState === "reviewing" ||
    submitState === "done";
  const sessionStage = useMemo<SessionStage>(() => {
    // 只读回访结算（recap）没有 draft，但要按 submitState 呈现复盘/评测中/可重试。
    if (!draft && !recapSubmission) return "preparing";
    if (submitState === "error") return "recoverable_error";
    if (submitState === "done") return "reviewed";
    if (submitState === "submitting") return "submitting";
    if (submitState === "reviewing") return "reviewing";
    if (runPhase !== "idle") return "testing";
    return "coding";
  }, [draft, recapSubmission, submitState, runPhase]);

  // 训练阶段进度（顶栏 stepper）。
  const sessionTimeline = useMemo(
    () =>
      buildSessionTimeline({
        stage: sessionStage,
        draft: draft
          ? { mode: draft.mode, modeLimitSec: draft.modeLimitSec, language: draft.language }
          : null,
        elapsedSec: timer.elapsedSec,
        snapshots: {
          accepted: snap.accepted,
          pending: snap.pending,
          lastError: snap.lastError,
        },
        test: {
          phase: runPhase,
          result: runResult,
          errorMessage: runError,
          showRunTest,
          canRunTest,
          runTestNote: null,
        },
        review: {
          reviewingElapsedSec,
          rating: masteryInfo.effective ?? masteryInfo.auto,
          errorMessage: finalizeError?.message ?? null,
          attempts: finalizedSubmission?.review_attempts,
        },
        canContinue,
      }),
    [
      sessionStage,
      draft,
      timer.elapsedSec,
      snap.accepted,
      snap.pending,
      snap.lastError,
      runPhase,
      runResult,
      runError,
      showRunTest,
      canRunTest,
      reviewingElapsedSec,
      masteryInfo.effective,
      masteryInfo.auto,
      finalizeError?.message,
      finalizedSubmission?.review_attempts,
      canContinue,
    ],
  );

  const nextProblemHref = useMemo(() => {
    const items = problemList?.items ?? [];
    if (items.length === 0) return "/";
    const currentIndex = items.findIndex((item) => item.id === problemId);
    const next = currentIndex >= 0
      ? items[(currentIndex + 1) % items.length]
      : items[0];
    return next ? `/problem/${next.id}` : "/";
  }, [problemList?.items, problemId]);

  const replayHref = finalizedSubmission
    ? `/history/${problemId}?submission=${encodeURIComponent(finalizedSubmission.id)}`
    : undefined;
  const editorCode = recapSubmission ? recapSubmission.code : code;
  // 离开本页前：把 timer 暂停（如果它还在跑），避免下次回来后台续跑，然后 navigate。
  // - frozen（submitting/reviewing/done）：timer 已停，不需要动
  // - 还没开始（无 draft）：timer 不在跑，togglePause 只是把 paused 切成 true，下次回来 useTimer 会按新 sid 重置 paused，无副作用
  const goBack = useCallback(() => {
    if (!timer.paused && !isTimerFrozen) {
      timer.togglePause();
    }
    navigate(fromPath);
  }, [timer, isTimerFrozen, navigate, fromPath]);

  if (Number.isNaN(problemId)) {
    return (
      <div className={styles.pageRoot}>
        <BackBar label={fromLabel} onBack={goBack} />
        <div className={styles.state}>
          <ErrorNotice
            error={{
              kind: "unknown",
              tone: "warning",
              title: "题目地址无效",
              message: "当前 URL 里没有有效的题目编号。请回到题库重新选择一道题。",
              code: "INVALID_PROBLEM_ID",
            }}
            variant="panel"
          />
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.pageRoot}>
        <BackBar label={fromLabel} onBack={goBack} />
        <div className={styles.state}>正在加载题目……</div>
      </div>
    );
  }
  if (error || !data) {
    const appError = toAppError(error, {
      title: "题目没有加载成功",
      message: "请确认后端正在运行，或回到题库重新选择题目。",
    });
    return (
      <div className={styles.pageRoot}>
        <BackBar label={fromLabel} onBack={goBack} />
        <div className={styles.state}>
          <ErrorNotice error={appError} variant="panel" />
        </div>
      </div>
    );
  }

  const reviewView = {
    phase: submitState,
    reviewingElapsedSec,
    progressEvents: reviewProgress.events,
    progressUnavailable: reviewProgress.sseFailed,
    submission: finalizedSubmission,
    errorMessage: null,
    errorView: finalizeError,
    userRating: masteryInfo.user,
    autoRating: masteryInfo.auto,
    effectiveRating: masteryInfo.effective,
    ratingPending: masteryMut.isPending,
    onPickRating: handlePickRating,
    onRetryReview: handleRetryReview,
    retryPending: reviewMut.isPending,
    replayHref,
    reviewPlanHref: "/review",
    nextProblemHref,
    exportInfo: {
      problemId,
      title: data.title,
      leetcodeId: data.leetcode_id,
      externalId: data.external_id,
    },
    onRestart: handleRestartAfterReview,
  };

  // 右栏是否呈现"工作台"（进行中会话 or 只读回访结算），否则呈现模式选择 / 载入态。
  const hasWorkspace = !!draft || !!recapSubmission;

  return (
    <div className={styles.pageRoot}>
      <SessionTopBar
        backLabel={fromLabel}
        onBack={goBack}
        hasSession={!!draft}
        timeline={sessionTimeline}
        timer={
          draft
            ? {
                mode: draft.mode,
                elapsedSec: timer.elapsedSec,
                remainingSec: timer.remainingSec,
                overdue: timer.overdue,
                paused: timer.paused,
                onTogglePause: timer.togglePause,
                onReset: () => {
                  void reset(draft.mode, draft.modeLimitSec, draft.language);
                  setSubmitState("idle");
                  setFinalizedSubmission(null);
                  setFinalizeError(null);
                  setPollingId(null);
                  setTOffsetBase(0);
                  resetRun();
                },
              }
            : null
        }
        test={{
          showRunTest,
          canRunTest,
          runTestNote: null,
          running: runBusy,
          onRunTest: handleRunTest,
        }}
        submit={{
          state: submitState,
          reviewingElapsedSec,
          canSubmit: !!draft?.submissionId,
          onSubmit: handleSubmit,
          onAskHelp: handleOpenHelp,
        }}
      />
      <ResizableTwoPane
        key={hasWorkspace ? "session" : "prepare"}
        resizable={hasWorkspace}
        defaultLeftPct={hasWorkspace ? 33 : 50}
        minLeftPct={hasWorkspace ? 24 : 40}
        minRightPct={40}
        storageKey="easycode:problem-two-pane"
        narrowNotice={
          hasWorkspace
            ? "这页需要同时查看题面和右侧内容。当前窗口过窄时会隐藏右栏，请切换到桌面宽度。"
            : "这页需要同时查看题面和模式选择。请切换到桌面宽度后再选择训练模式。"
        }
        left={
          <ProblemStatement
            title={data.title}
            leetcodeId={data.leetcode_id}
            externalId={data.external_id}
            category={data.category}
            isCore={data.is_core}
            markdown={data.statement_md}
            problemId={problemId}
          />
        }
        right={
          hasWorkspace ? (
            <WorkspacePane
              stage={sessionStage}
              editor={
                <CodeEditor
                  code={editorCode}
                  onChange={handleCodeChange}
                  language={language}
                  readOnly={codeReadOnly}
                  onAttemptReadOnlyEdit={
                    canContinue ? handleAttemptReadOnlyEdit : undefined
                  }
                />
              }
              test={{
                phase: runPhase,
                result: runResult,
                errorMessage: runError,
                runTestNote: null,
              }}
              review={reviewView}
              runtimeMessage={submitRuntimeMessage}
              leetcodeFallbackNotice={leetcodeFallback}
              canContinue={canContinue}
              onContinue={handleAttemptReadOnlyEdit}
            />
          ) : urlSid ? (
            // 地址栏带 ?sid= 但尚未解析出这一局（draft/recap 均未就绪）：先占位，
            // 避免闪出模式选择表单，随后要么进入回访结算、要么无效被抹掉 sid。
            <div className={styles.state}>正在载入这一局……</div>
          ) : (
            <ModeSelectForm
              problemTitle={data.title}
              creating={creating}
              templates={tests.data?.templates}
              residualLanguage={residualLanguage}
              continuePending={continuePending}
              onContinueResidual={handleContinueResidual}
              onClearResidual={handleClearResidual}
              onConfirm={(mode, limit, lang, ioFmt) => {
                // LeetCode 模式且该题有该语言模板 → 播种可见外壳；否则回退 ACM 空白。
                const tmpl = tests.data?.templates?.[lang];
                const resolved = ioFmt === "leetcode" && tmpl ? tmpl : "";
                if (resolved) seed(lang, resolved, { onlyIfEmpty: true });
                setLeetcodeFallback(ioFmt === "leetcode" && !tmpl);
                void startOrResume(mode, limit, lang);
              }}
            />
          )
        }
      />
      <HelpDrawer
        open={helpOpen}
        loading={helpMut.isPending}
        loadingHistory={tutorMessages.isLoading}
        error={helpErr ?? (tutorMessages.error ? toAppError(tutorMessages.error) : null)}
        messages={helpMessages}
        currentTier={helpCurrentTier}
        pendingStudent={pendingHelpQuestion}
        streamingText={streamingHelpText}
        streamFallback={helpStreamFallback}
        onClose={() => setHelpOpen(false)}
        onAsk={handleAsk}
      />
    </div>
  );
}
