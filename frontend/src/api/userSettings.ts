import { api } from "./client";
import type { LLMSettings, LLMSettingsPatch } from "./types";

export async function getLLMSettings(): Promise<LLMSettings> {
  const { data } = await api.get<LLMSettings>("/settings/llm");
  return data;
}

export async function patchLLMSettings(payload: LLMSettingsPatch): Promise<LLMSettings> {
  const { data } = await api.patch<LLMSettings>("/settings/llm", payload);
  return data;
}
