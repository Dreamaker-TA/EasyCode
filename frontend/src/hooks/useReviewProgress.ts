import { useEffect, useMemo, useState } from "react";

import { apiUrl } from "@/api/client";

export type ReviewProgressStage =
  | "queued"
  | "deterministic_shortcut"
  | "llm_sampling"
  | "guardrail"
  | "done";

export interface ReviewProgressEvent {
  stage: ReviewProgressStage;
  detail: Record<string, unknown> | null;
  ts: string;
}

interface ReviewProgressState {
  events: ReviewProgressEvent[];
  sseFailed: boolean;
  terminal: boolean;
}

const INITIAL_STATE: ReviewProgressState = {
  events: [],
  sseFailed: false,
  terminal: false,
};

export function useReviewProgress(
  submissionId: string | null,
  enabled: boolean,
): ReviewProgressState {
  const [state, setState] = useState<ReviewProgressState>(INITIAL_STATE);

  useEffect(() => {
    setState(INITIAL_STATE);
    if (!enabled || !submissionId) {
      return;
    }
    if (typeof EventSource === "undefined") {
      setState({ ...INITIAL_STATE, sseFailed: true });
      return;
    }

    const source = new EventSource(reviewEventsUrl(submissionId));
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
    };

    source.addEventListener("stage", (message) => {
      const parsed = parseProgressEvent(message.data);
      if (!parsed) return;
      setState((prev) => ({
        events: [...prev.events, parsed],
        sseFailed: false,
        terminal: parsed.stage === "done" || prev.terminal,
      }));
      if (parsed.stage === "done") close();
    });

    source.onerror = () => {
      setState((prev) => ({ ...prev, sseFailed: true }));
      close();
    };

    return close;
  }, [enabled, submissionId]);

  return useMemo(() => state, [state]);
}

function reviewEventsUrl(submissionId: string): string {
  return apiUrl(`/submissions/${encodeURIComponent(submissionId)}/review/events`);
}

function parseProgressEvent(raw: string): ReviewProgressEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ReviewProgressEvent>;
    if (!isReviewProgressStage(parsed.stage)) return null;
    return {
      stage: parsed.stage,
      detail: isRecord(parsed.detail) ? parsed.detail : null,
      ts: typeof parsed.ts === "string" ? parsed.ts : "",
    };
  } catch {
    return null;
  }
}

function isReviewProgressStage(value: unknown): value is ReviewProgressStage {
  return (
    value === "queued" ||
    value === "deterministic_shortcut" ||
    value === "llm_sampling" ||
    value === "guardrail" ||
    value === "done"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
