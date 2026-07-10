import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listTutorMessages,
  postTutorMessage,
  postTutorMessageStream,
  TutorStreamError,
} from "@/api/tutor";
import type { TutorMessageListResponse, TutorMessagePostResponse } from "@/api/types";

interface SendTutorMessageVars {
  submissionId: string;
  content: string;
  currentCode: string | null;
  onDelta: (delta: string) => void;
  onStreamFallback: () => void;
}

export function useTutorMessages(
  submissionId: string | null,
  enabled: boolean,
) {
  return useQuery<TutorMessageListResponse, Error>({
    queryKey: ["tutorMessages", submissionId],
    queryFn: () => {
      if (!submissionId) throw new Error("submission id is required");
      return listTutorMessages(submissionId);
    },
    enabled: enabled && !!submissionId,
    staleTime: 10_000,
  });
}

export function useSendTutorMessage() {
  const qc = useQueryClient();

  return useMutation<TutorMessagePostResponse, Error, SendTutorMessageVars>({
    mutationFn: async ({
      submissionId,
      content,
      currentCode,
      onDelta,
      onStreamFallback,
    }) => {
      try {
        return await postTutorMessageStream(
          submissionId,
          content,
          currentCode,
          onDelta,
        );
      } catch (streamError) {
        if (streamError instanceof TutorStreamError && streamError.receivedAnyEvent) {
          void qc.invalidateQueries({ queryKey: ["tutorMessages", submissionId] });
          throw streamError;
        }
        onStreamFallback();
        try {
          return await postTutorMessage(submissionId, content, currentCode);
        } catch (fallbackError) {
          throw fallbackError;
        }
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["tutorMessages", vars.submissionId] });
    },
  });
}
