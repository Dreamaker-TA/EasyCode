import { useMutation } from "@tanstack/react-query";

import { finalizeSubmission } from "@/api/submissions";
import type { RunResult, SubmissionDetail } from "@/api/types";

interface Vars {
  submissionId: string;
  code: string;
  elapsedSec: number;
  // submit 时浏览器预跑得到的执行结果；后端会复跑并以服务端结果为准。
  testResults?: RunResult | null;
}

/**
 * 调 POST /submissions/{id}/finalize。起后端**立即返回** status=reviewing、
 * reviewed_at=null，LLM 评测走 BackgroundTasks。
 *
 * 因此本 hook 不再在 onSuccess 写评级缓存——评级要等后台评测完成才有。调用方拿到
 * reviewing 响应后用 usePollSubmissionReview 轮询，缓存同步 / invalidate 在轮询终态处做。
 */
export function useFinalizeSubmission() {
  return useMutation<SubmissionDetail, Error, Vars>({
    mutationFn: ({ submissionId, code, elapsedSec, testResults }) =>
      finalizeSubmission(submissionId, code, elapsedSec, testResults),
  });
}
