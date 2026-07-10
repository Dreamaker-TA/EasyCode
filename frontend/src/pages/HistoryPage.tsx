import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { getSubmission } from "@/api/submissions";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ErrorNotice } from "@/components/ErrorNotice";
import { HistoryToolbar, type HistoryFilter } from "@/components/HistoryToolbar";
import { ReviewPanel } from "@/components/ReviewPanel";
import { SkeletonLines } from "@/components/Skeleton";
import { SnapshotReplay } from "@/components/SnapshotReplay";
import { showToast } from "@/components/StatusToast";
import { SubmissionList } from "@/components/SubmissionList";
import { useDeleteSubmissions } from "@/hooks/useDeleteSubmissions";
import { useProblemDetail } from "@/hooks/useProblemDetail";
import { useReviewProgress } from "@/hooks/useReviewProgress";
import { useReviewSubmission } from "@/hooks/useReviewSubmission";
import { useSubmissionHistory } from "@/hooks/useSubmissionHistory";
import { parseBackendDateTime } from "@/lib/datetime";
import type { AppErrorView } from "@/lib/errors";
import { reviewErrorToAppError, toAppError } from "@/lib/errors";
import { invalidateTrainingAggregates } from "@/lib/queryInvalidation";

import styles from "./HistoryPage.module.css";

/** 提交记录每页条数：只保留最新 5 条，其余翻页查看。 */
const PAGE_SIZE = 5;

export function HistoryPage() {
  const { problemId: idStr } = useParams();
  const problemId = idStr ? Number(idStr) : NaN;
  const location = useLocation();
  const navigate = useNavigate();
  const requestedSubmissionId = useMemo(
    () => new URLSearchParams(location.search).get("submission"),
    [location.search],
  );
  const fromPath = location.pathname + location.search;
  // 只有"从题目内部"进历史（题面「历史」链接、评测面板「看过程回放」）才带 fromProblem，
  // 据此才显示"回到题目"引导；从题库/仪表盘/历史列表直接进来则不显示。
  // backToProblem：评测面板「看过程回放」还会带上本局结算 URL（/problem/:id?sid=），
  // "回到题目"据此精确返回那一局的结算面板，而非丢失会话号的 /problem/:id。
  const navState = location.state as
    | { fromProblem?: boolean; backToProblem?: string }
    | null;
  const cameFromProblem = Boolean(navState?.fromProblem);
  const backToProblem = navState?.backToProblem;
  const { data: problem, isLoading: loadingProblem } = useProblemDetail(problemId);
  const { data: history, isLoading: loadingHistory, error } =
    useSubmissionHistory(Number.isNaN(problemId) ? undefined : problemId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [page, setPage] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<AppErrorView | null>(null);

  const deleteMut = useDeleteSubmissions(
    Number.isNaN(problemId) ? undefined : problemId,
  );

  // 切题时清空所有附加状态（selectedId 会在 history 同步 effect 里补选）
  useEffect(() => {
    setSelectedId(null);
    setFilter("all");
    setPage(0);
    setSelectionMode(false);
    setSelectedIds(new Set());
    setConfirmOpen(false);
    setDeleteError(null);
  }, [problemId]);

  const currentEffective = problem?.mastery?.effective_rating ?? null;
  const currentSubmissionId = problem?.last_submission_id ?? null;
  const allItems = useMemo(
    () =>
      (history?.items ?? [])
        .filter((it) => it.status === "submitted" || it.status === "review_failed")
        .map((it) => ({
          ...it,
          effective_rating:
            currentSubmissionId && it.id === currentSubmissionId
              ? currentEffective
              : it.user_rating_override ?? it.review_rating ?? null,
        })),
    [currentEffective, currentSubmissionId, history?.items],
  );

  const effectiveForItem = useCallback(
    (item: (typeof allItems)[number]) =>
      item.effective_rating ?? item.user_rating_override ?? item.review_rating ?? null,
    [],
  );

  const counts = useMemo(() => {
    let passed = 0;
    let failed = 0;
    for (const it of allItems) {
      const eff = effectiveForItem(it);
      // null（评测失败 / 未评测）按用户决策归到「未通过」
      if (eff === "A" || eff === "B") passed += 1;
      else failed += 1;
    }
    return { all: allItems.length, passed, failed };
  }, [allItems]);

  const visibleItems = useMemo(() => {
    if (filter === "all") return allItems;
    return allItems.filter((it) => {
      const eff = effectiveForItem(it);
      const isPassed = eff === "A" || eff === "B";
      return filter === "passed" ? isPassed : !isPassed;
    });
  }, [allItems, effectiveForItem, filter]);

  // 分页：只在页面上展示最新 5 条，其余翻页查看。selectedIds 是跨页保留的 Set，
  // 所以选择模式下可以翻页累积勾选，只有「全选可见」限定在当前页。
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedItems = useMemo(
    () => visibleItems.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [visibleItems, currentPage],
  );

  // 删除 / 筛选后页码越界 → 收敛到最后一页。
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  // 选中项（深链或自动补选）不在当前页 → 跳到它所在页，保证详情与列表对得上。
  // 只依赖 selectedId / visibleItems：纯翻页不会触发，避免把用户"拽回"选中页。
  useEffect(() => {
    if (!selectedId) return;
    const idx = visibleItems.findIndex((it) => it.id === selectedId);
    if (idx < 0) return;
    const target = Math.floor(idx / PAGE_SIZE);
    setPage((prev) => (prev === target ? prev : target));
  }, [selectedId, visibleItems]);

  const handleSelectSubmission = useCallback(
    (submissionId: string) => {
      setSelectedId(submissionId);
      const params = new URLSearchParams(location.search);
      params.set("submission", submissionId);
      navigate(
        {
          pathname: location.pathname,
          search: `?${params.toString()}`,
        },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  // history 加载完 / 当前选中项被删 → 重新选一条；只允许终态记录进入历史详情。
  useEffect(() => {
    if (!history) return;
    if (
      requestedSubmissionId &&
      allItems.some((it) => it.id === requestedSubmissionId)
    ) {
      if (selectedId !== requestedSubmissionId) {
        setSelectedId(requestedSubmissionId);
      }
      return;
    }
    const stillExists = selectedId
      ? allItems.some((it) => it.id === selectedId)
      : false;
    if (!stillExists) {
      setSelectedId(visibleItems[0]?.id ?? allItems[0]?.id ?? null);
    }
  }, [allItems, history, requestedSubmissionId, selectedId, visibleItems]);

  const allVisibleSelected =
    pagedItems.length > 0 &&
    pagedItems.every((it) => selectedIds.has(it.id));

  const handleToggleSelectionMode = () => {
    setSelectionMode((m) => {
      if (m) setSelectedIds(new Set());
      return !m;
    });
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        pagedItems.forEach((it) => next.delete(it.id));
      } else {
        pagedItems.forEach((it) => next.add(it.id));
      }
      return next;
    });
  };

  const handleAskDelete = () => {
    if (selectedIds.size === 0) return;
    setDeleteError(null);
    setConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    const ids = Array.from(selectedIds);
    const willDropSelected = !!selectedId && selectedIds.has(selectedId);
    deleteMut.mutate(
      { ids },
      {
        onSuccess: (result) => {
          if (willDropSelected) setSelectedId(null);
          setSelectedIds(new Set());
          setSelectionMode(false);
          setConfirmOpen(false);
          showToast(
            <>
              已删除 <span className="tnum">{result.deleted}</span> 条记录
              {result.not_found.length > 0 && (
                <>
                  ，<span className="tnum">{result.not_found.length}</span> 条已不存在
                </>
              )}
            </>,
          );
        },
        onError: (err) => {
          setConfirmOpen(false);
          setDeleteError(
            toAppError(err, {
              title: "删除没有完成",
              message: "提交记录和快照没有被删除。请重试；如果持续失败，检查后端和数据库状态。",
            }),
          );
        },
      },
    );
  };

  const subtitle = useMemo(() => {
    if (loadingHistory) return "正在加载历史……";
    if (error) return "历史没有加载成功，请按下方提示恢复。";
    return `历次提交 ${allItems.length} 次`;
  }, [allItems.length, loadingHistory, error]);

  if (Number.isNaN(problemId)) {
    return <div className={styles.state}>题目 ID 无效</div>;
  }

  // 选择模式下隐藏详情视图，避免大块内容遮挡操作区
  const showDetail = !selectionMode && selectedId;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.crumbs}>
          <Link to="/history" className={styles.crumbLink}>← 历史</Link>
          {problem && cameFromProblem && (
            <>
              <span className={styles.crumbSep}>·</span>
              <Link
                to={backToProblem ?? `/problem/${problemId}`}
                state={{ from: fromPath }}
                className={`${styles.crumbLink} ${styles.crumbPrimary}`}
              >
                回到题目
              </Link>
            </>
          )}
        </div>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>
            {loadingProblem
              ? "正在加载题目……"
              : problem
                ? `${problem.leetcode_id ?? problem.external_id ?? "—"}. ${problem.title}`
                : `题目 ${problemId}`}
          </h1>
          <Button
            as="link"
            to={`/problem/${problemId}`}
            state={{ from: fromPath }}
            variant="primary"
            size="md"
            className={styles.practiceAction}
          >
            开始练习
          </Button>
        </div>
        <p className={styles.subtitle}>{subtitle}</p>
      </header>

      {history && allItems.length > 0 && (
        <HistoryToolbar
          filter={filter}
          onFilterChange={(next) => {
            setFilter(next);
            setPage(0);
          }}
          counts={counts}
          selectionMode={selectionMode}
          onToggleSelectionMode={handleToggleSelectionMode}
          selectedCount={selectedIds.size}
          visibleCount={pagedItems.length}
          allVisibleSelected={allVisibleSelected}
          onSelectAllVisible={handleSelectAllVisible}
          onDeleteSelected={handleAskDelete}
          deletePending={deleteMut.isPending}
        />
      )}

      {deleteError && <ErrorNotice error={deleteError} variant="panel" />}
      {error && (
        <ErrorNotice
          error={toAppError(error, {
            title: "历史没有加载成功",
            message: "请确认后端正在运行；如果刚删除或重新导入过题库，请刷新后再试。",
          })}
          variant="panel"
        />
      )}

      {history && (
        <SubmissionList
          items={pagedItems}
          onSelect={handleSelectSubmission}
          selectedId={selectedId}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
        />
      )}

      {history && pageCount > 1 && (
        <nav className={styles.pager}>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
          >
            ← 上一页
          </Button>
          <span className={styles.pagerStatus}>
            第 {currentPage + 1} / {pageCount} 页 · 共 {visibleItems.length} 条
          </span>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={currentPage >= pageCount - 1}
          >
            下一页 →
          </Button>
        </nav>
      )}

      {showDetail && (
        <SubmissionDetailView
          submissionId={selectedId}
          exportInfo={{
            problemId,
            title: problem?.title ?? `题目 ${problemId}`,
            leetcodeId: problem?.leetcode_id ?? null,
            externalId: problem?.external_id ?? null,
          }}
          currentSubmissionId={currentSubmissionId}
          currentEffectiveRating={currentEffective}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={`确认删除 ${selectedIds.size} 条提交记录？`}
        description="此操作不可撤销，将同时删除这些提交的代码快照与相关的 SRS 排程。"
        confirmLabel="删除"
        variant="danger"
        loading={deleteMut.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!deleteMut.isPending) setConfirmOpen(false);
        }}
      />
    </div>
  );
}

function SubmissionDetailView({
  submissionId,
  exportInfo,
  currentSubmissionId,
  currentEffectiveRating,
}: {
  submissionId: string;
  exportInfo: {
    problemId: number;
    title: string;
    leetcodeId: number | null;
    externalId: string | null;
  };
  currentSubmissionId: string | null;
  currentEffectiveRating: "A" | "B" | "C" | "D" | null;
}) {
  const qc = useQueryClient();
  const retryMut = useReviewSubmission();
  const [retryError, setRetryError] = useState<AppErrorView | null>(null);
  const [observedPending, setObservedPending] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["submission", submissionId],
    queryFn: () => getSubmission(submissionId),
    staleTime: 60_000,
    // 若落在还在后台评测的提交上，轮询到 reviewed_at 落值即停。
    refetchInterval: (query) =>
      query.state.data?.reviewed_at ? false : 2000,
  });
  const pending = !!data && !data.reviewed_at;
  const reviewProgress = useReviewProgress(submissionId, pending);
  const reviewingElapsedSec = useReviewingElapsedSec(
    data?.review_started_at ?? data?.submitted_at ?? data?.created_at ?? null,
    pending,
  );
  useEffect(() => {
    setObservedPending(false);
  }, [submissionId]);

  useEffect(() => {
    if (pending) {
      setObservedPending(true);
      return;
    }
    if (!observedPending || !data?.reviewed_at) return;
    setObservedPending(false);
    qc.invalidateQueries({ queryKey: ["submissions", data.problem_id] });
    qc.invalidateQueries({ queryKey: ["problem", data.problem_id] });
    invalidateTrainingAggregates(qc);
    showToast(data.status === "submitted" ? "评测已完成" : "评测未完成，请查看恢复建议");
  }, [data, observedPending, pending, qc]);

  if (isLoading) {
    return (
      <div className={styles.detail}>
        <div className={styles.detailReview}>
          <SkeletonLines rows={3} />
          <SkeletonLines rows={4} />
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className={styles.detailState}>
        <ErrorNotice
          error={toAppError(error, {
            title: "提交详情没有加载成功",
            message: "这条提交可能已被删除，或后端暂时不可达。请回到历史列表重新选择。",
          })}
        />
      </div>
    );
  }

  const review = data.review ?? null;
  const degraded =
    !!data.reviewed_at && (data.status === "review_failed" || !!review?.error);
  const effective: ReturnType<typeof inferEffective> =
    data.id === currentSubmissionId
      ? currentEffectiveRating
      : inferEffective(data);

  const handleRetryReview = () => {
    setRetryError(null);
    retryMut.mutate(submissionId, {
      onSuccess: (next) => {
        qc.setQueryData(["submission", submissionId], next);
        showToast("已重新发起评测");
      },
      onError: (err) => setRetryError(toAppError(err)),
    });
  };

  return (
    <div className={styles.detail}>
      {/* 全宽单列：本次训练报告在上，代码提交内容在下。 */}
      <div className={styles.detailReview}>
        {pending ? (
          <ReviewPanel
            phase="reviewing"
            reviewingElapsedSec={reviewingElapsedSec}
            progressEvents={reviewProgress.events}
            progressUnavailable={reviewProgress.sseFailed}
            submission={data}
            errorMessage={null}
            userRating={data.user_rating_override}
            autoRating={review?.rating ?? null}
            effectiveRating={effective}
            ratingPending={false}
            onPickRating={() => {}}
            onRetryReview={handleRetryReview}
            retryPending={retryMut.isPending}
            readOnly
            exportInfo={exportInfo}
          />
        ) : degraded ? (
          <ReviewPanel
            phase="error"
            reviewingElapsedSec={0}
            submission={data}
            errorMessage={review?.error ?? null}
            errorView={reviewErrorToAppError(
              review?.error_code ?? data.review_last_error_code,
              review?.error,
            )}
            userRating={data.user_rating_override}
            autoRating={review?.rating ?? null}
            effectiveRating={effective}
            ratingPending={false}
            onPickRating={() => {}}
            onRetryReview={handleRetryReview}
            retryPending={retryMut.isPending}
            readOnly={false}
            exportInfo={exportInfo}
          />
        ) : review ? (
          <ReviewPanel
            phase="done"
            reviewingElapsedSec={0}
            submission={data}
            errorMessage={null}
            userRating={data.user_rating_override}
            autoRating={review.rating}
            effectiveRating={effective}
            ratingPending={false}
            onPickRating={() => {}}
            onRetryReview={() => {}}
            retryPending={false}
            readOnly
            reportLayout="toggle"
            exportInfo={exportInfo}
          />
        ) : (
          <p className={styles.detailState}>这次提交没有评测结果。</p>
        )}
        {retryError && <ErrorNotice error={retryError} />}
      </div>
      <div className={styles.detailCode}>
        <div className={styles.detailLabel}>代码提交内容 · 过程回放</div>
        <SnapshotReplay
          submissionId={submissionId}
          finalCode={data.code}
          elapsedSec={data.elapsed_sec}
          language={data.language}
        />
      </div>
    </div>
  );
}

function inferEffective(detail: {
  user_rating_override: "A" | "B" | "C" | "D" | null;
  review: { rating: "A" | "B" | "C" | "D" | null } | null;
}) {
  return detail.user_rating_override ?? detail.review?.rating ?? null;
}

function useReviewingElapsedSec(anchorIso: string | null, enabled: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!enabled || !anchorIso) {
      setElapsed(0);
      return;
    }
    const anchor = parseBackendDateTime(anchorIso);
    if (!anchor) {
      setElapsed(0);
      return;
    }
    const anchorMs = anchor.getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - anchorMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [anchorIso, enabled]);

  return elapsed;
}
