import { API_BASE_URL, ApiError, api } from "./client";
import type {
  BackendError,
  TutorMessageListResponse,
  TutorMessagePostResponse,
} from "./types";

interface TutorStreamEvent {
  event: "delta" | "message" | "error";
  data: unknown;
}

export class TutorStreamError extends ApiError {
  constructor(
    code: string,
    message: string,
    status: number,
    public readonly receivedAnyEvent: boolean,
  ) {
    super(code, message, status);
    this.name = "TutorStreamError";
  }
}

export async function listTutorMessages(
  submissionId: string,
): Promise<TutorMessageListResponse> {
  const resp = await api.get<TutorMessageListResponse>(
    `/submissions/${submissionId}/tutor/messages`,
  );
  return resp.data;
}

export async function postTutorMessage(
  submissionId: string,
  content: string,
  currentCode: string | null,
): Promise<TutorMessagePostResponse> {
  const resp = await api.post<TutorMessagePostResponse>(
    `/submissions/${submissionId}/tutor/messages`,
    { content, current_code: currentCode },
  );
  return resp.data;
}

export async function postTutorMessageStream(
  submissionId: string,
  content: string,
  currentCode: string | null,
  onDelta: (delta: string) => void,
): Promise<TutorMessagePostResponse> {
  const resp = await fetch(
    `${API_BASE_URL}/submissions/${encodeURIComponent(submissionId)}/tutor/messages`,
    {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ content, current_code: currentCode }),
    },
  );

  if (!resp.ok) {
    throw await errorFromResponse(resp);
  }
  if (!resp.body) {
    throw new ApiError("TUTOR_STREAM_UNAVAILABLE", "stream response is empty", 0);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalMessage: TutorMessagePostResponse | null = null;
  let receivedAnyEvent = false;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = drainSseBuffer(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) {
      if (event.event === "delta") {
        const delta = isRecord(event.data) && typeof event.data.delta === "string"
          ? event.data.delta
          : "";
        if (delta) {
          receivedAnyEvent = true;
          onDelta(delta);
        }
      } else if (event.event === "message") {
        receivedAnyEvent = true;
        finalMessage = assertTutorPostResponse(event.data);
      } else if (event.event === "error") {
        const data = isRecord(event.data) ? event.data : {};
        throw new TutorStreamError(
          typeof data.code === "string" ? data.code : "TUTOR_STREAM_FAILED",
          typeof data.message === "string" ? data.message : "Tutor stream failed",
          0,
          receivedAnyEvent,
        );
      }
    }
  }

  if (buffer.trim()) {
    for (const event of parseSseBlock(buffer)) {
      if (event.event === "message") {
        receivedAnyEvent = true;
        finalMessage = assertTutorPostResponse(event.data);
      }
    }
  }
  if (!finalMessage) {
    throw new TutorStreamError(
      "TUTOR_STREAM_INCOMPLETE",
      "Tutor stream ended before final message",
      0,
      receivedAnyEvent,
    );
  }
  return finalMessage;
}

async function errorFromResponse(resp: Response): Promise<ApiError> {
  try {
    const body = (await resp.json()) as BackendError;
    if (body?.error) {
      return new ApiError(
        body.error.code,
        body.error.message,
        resp.status,
        body.error.details ?? {},
      );
    }
  } catch {
    // Fall through to generic error.
  }
  return new ApiError("NETWORK_ERROR", resp.statusText || "network error", resp.status);
}

function drainSseBuffer(input: string): { events: TutorStreamEvent[]; rest: string } {
  const parts = input.split(/\n\n/);
  const rest = parts.pop() ?? "";
  return {
    events: parts.flatMap(parseSseBlock),
    rest,
  };
}

function parseSseBlock(block: string): TutorStreamEvent[] {
  const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
  const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
  if (!eventLine || !dataLine) return [];
  const event = eventLine.slice("event:".length).trim();
  if (event !== "delta" && event !== "message" && event !== "error") return [];
  try {
    return [{ event, data: JSON.parse(dataLine.slice("data:".length).trim()) }];
  } catch {
    return [];
  }
}

function assertTutorPostResponse(value: unknown): TutorMessagePostResponse {
  if (!isRecord(value) || !isRecord(value.message)) {
    throw new ApiError("TUTOR_STREAM_INVALID", "Tutor stream returned invalid message", 0);
  }
  const message = value.message;
  if (
    typeof message.id !== "number" ||
    typeof message.submission_id !== "string" ||
    (message.role !== "student" && message.role !== "tutor") ||
    typeof message.content !== "string" ||
    typeof message.tier_at !== "number" ||
    typeof message.created_at !== "string" ||
    typeof value.tier_before !== "number" ||
    typeof value.tier_after !== "number"
  ) {
    throw new ApiError("TUTOR_STREAM_INVALID", "Tutor stream returned invalid message", 0);
  }
  return {
    message: {
      id: message.id,
      submission_id: message.submission_id,
      role: message.role,
      content: message.content,
      tier_at: message.tier_at,
      created_at: message.created_at,
    },
    tier_before: value.tier_before,
    tier_after: value.tier_after,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
