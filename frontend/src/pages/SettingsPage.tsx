import { type FormEvent, useEffect, useMemo, useState } from "react";

import type {
  DiagnosticCheck,
  DiagnosticsResponse,
  LLMSettings,
  StructuredOutputMode,
} from "@/api/types";
import { AnswerFormatSettings } from "@/components/AnswerFormatSettings";
import { Button } from "@/components/Button";
import { ErrorNotice } from "@/components/ErrorNotice";
import { showToast } from "@/components/StatusToast";
import { ThemeSettings } from "@/components/ThemeSettings";
import { useDiagnostics } from "@/hooks/useDiagnostics";
import { useLLMSettings, usePatchLLMSettings } from "@/hooks/useLLMSettings";
import { toAppError } from "@/lib/errors";

import styles from "./SettingsPage.module.css";

const PROVIDERS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "~anthropic/claude-sonnet-latest",
  },
  {
    id: "ollama",
    label: "Ollama / 本地",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5-coder:14b",
  },
] as const;

const STRUCTURED_OPTIONS: Array<{ value: StructuredOutputMode; label: string }> = [
  { value: "auto", label: "自动选择" },
  { value: "json_schema", label: "按字段格式输出" },
  { value: "json_object", label: "只输出 JSON 对象" },
  { value: "text", label: "纯文本（兼容选项）" },
];

interface FormState {
  llm_base_url: string;
  llm_model: string;
  structured_output_mode: StructuredOutputMode;
}

interface BannerState {
  tone: "ok" | "warn" | "error";
  title: string;
  message: string;
}

function initialForm(settings: LLMSettings): FormState {
  return {
    llm_base_url: settings.llm_base_url,
    llm_model: settings.llm_model,
    structured_output_mode: settings.structured_output_mode,
  };
}

function firstProblem(data: DiagnosticsResponse | undefined): DiagnosticCheck | null {
  if (!data) return null;
  const checks = [
    ...data.review.checks,
    ...data.runtime.checks,
    ...data.execution.checks,
    ...data.problems.checks,
  ];
  return checks.find((check) => check.status === "error") ?? checks.find((check) => check.status === "warn") ?? null;
}

function buildBanner(
  diagnostics: DiagnosticsResponse | undefined,
  settings: LLMSettings | undefined,
  hasError: boolean,
): BannerState {
  if (hasError) {
    return {
      tone: "error",
      title: "设置暂时不可用",
      message: "本地服务没有响应。恢复后重新打开设置，即可继续修改 AI 评测设置。",
    };
  }
  const problem = firstProblem(diagnostics);
  if (problem) {
    return {
      tone: problem.status,
      title: problem.label,
      message: problem.recovery ?? problem.message,
    };
  }
  return {
    tone: "ok",
    title: "AI 评测设置正常",
    message: settings
      ? `${settings.llm_provider} / ${settings.llm_model} 已作为当前评测模型。`
      : "当前评测配置可以使用。",
  };
}

function providerValue(baseUrl: string): string {
  return PROVIDERS.find((provider) => provider.baseUrl === baseUrl)?.id ?? "custom";
}

export function SettingsPage() {
  const {
    data: diagnostics,
    isLoading: diagnosticsLoading,
    error: diagnosticsError,
  } = useDiagnostics();
  const {
    data: llmSettings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useLLMSettings();
  const patchSettings = usePatchLLMSettings();
  const [form, setForm] = useState<FormState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);

  useEffect(() => {
    if (llmSettings) {
      setForm(initialForm(llmSettings));
      setApiKey("");
      setClearKey(false);
    }
  }, [llmSettings]);

  const banner = useMemo(
    () => buildBanner(diagnostics, llmSettings, Boolean(diagnosticsError || settingsError)),
    [diagnostics, diagnosticsError, llmSettings, settingsError],
  );

  const isLoading = (diagnosticsLoading || settingsLoading) && !form;
  const settingsLoadError = settingsError && !settingsLoading && !form;
  const provider = form ? providerValue(form.llm_base_url) : "custom";
  const canSave =
    Boolean(form?.llm_base_url.trim()) &&
    Boolean(form?.llm_model.trim()) &&
    !patchSettings.isPending &&
    !isLoading;

  function updateForm(next: Partial<FormState>) {
    setForm((current) => (current ? { ...current, ...next } : current));
  }

  function onProviderChange(value: string) {
    if (value === "custom") {
      updateForm({ llm_base_url: "", llm_model: "" });
      return;
    }
    const preset = PROVIDERS.find((item) => item.id === value);
    if (!preset) return;
    updateForm({ llm_base_url: preset.baseUrl, llm_model: preset.model });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    patchSettings.mutate(
      {
        ...form,
        llm_api_key: apiKey.trim() ? apiKey.trim() : undefined,
        clear_llm_api_key: clearKey,
      },
      {
        onSuccess: () => {
          setApiKey("");
          setClearKey(false);
          showToast("设置已保存");
        },
      },
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div>
          <p className="kicker">设置</p>
          <h1 className={styles.title}>模型与外观</h1>
          <p className={styles.subtitle}>修改评测模型连接方式，并选择适合自己的界面主题。</p>
        </div>
      </header>

      <section
        className={`${styles.banner} tone-${banner.tone === "error" ? "danger" : banner.tone}`}
      >
        <strong>{banner.title}</strong>
        <span>{banner.message}</span>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <div>
            <p className="kicker">AI 评测</p>
            <h2 className={styles.panelTitle}>
              评测模型
            </h2>
            <p className={styles.panelCopy}>模型服务地址、模型名和访问密钥会保存到本机。密钥只写入，不会再次显示。</p>
          </div>
          {llmSettings?.llm_key_configured && !clearKey && (
            <span className={styles.keyBadge}>访问密钥已配置</span>
          )}
        </div>

        {settingsLoadError ? (
          <ErrorNotice
            variant="panel"
            error={toAppError(settingsError, {
              title: "设置没有读取成功",
              message: "当前无法读取模型配置。请确认后端正在运行，或稍后重试。",
            })}
          />
        ) : isLoading || !form ? (
          <div className={styles.loading}>正在读取设置...</div>
        ) : (
          <form className={styles.form} onSubmit={onSubmit}>
            <label className={styles.field}>
              <span>模型提供商</span>
              <select value={provider} onChange={(event) => onProviderChange(event.target.value)}>
                {PROVIDERS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
                <option value="custom">自定义</option>
              </select>
            </label>

            <label className={styles.field}>
              <span>模型服务地址</span>
              <input
                value={form.llm_base_url}
                onChange={(event) => updateForm({ llm_base_url: event.target.value })}
                inputMode="url"
                spellCheck={false}
                placeholder="https://api.deepseek.com"
              />
            </label>

            <label className={styles.field}>
              <span>模型名称</span>
              <input
                value={form.llm_model}
                onChange={(event) => updateForm({ llm_model: event.target.value })}
                spellCheck={false}
                placeholder="deepseek-v4-flash"
              />
            </label>

            <label className={styles.field}>
              <span>访问密钥</span>
              <input
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                }}
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={llmSettings?.llm_key_configured ? "留空表示不修改当前密钥" : "输入你的访问密钥"}
                disabled={clearKey}
              />
            </label>

            <div className={styles.toggleRow}>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(event) => {
                    setClearKey(event.target.checked);
                    if (event.target.checked) setApiKey("");
                  }}
                />
                <span>清除当前访问密钥</span>
              </label>
            </div>

            <label className={styles.field}>
              <span>结构化输出</span>
              <select
                value={form.structured_output_mode}
                onChange={(event) =>
                  updateForm({ structured_output_mode: event.target.value as StructuredOutputMode })
                }
              >
                {STRUCTURED_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {patchSettings.error && (
              <ErrorNotice
                variant="inline"
                error={toAppError(patchSettings.error, {
                  title: "设置没有保存成功",
                  message: "配置没有写入本机。请检查后端是否在运行，然后重试。",
                })}
              />
            )}

            <div className={styles.actions}>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className={styles.primaryBtn}
                disabled={!canSave}
              >
                {patchSettings.isPending ? "保存中" : "保存设置"}
              </Button>
            </div>
          </form>
        )}
      </section>

      <AnswerFormatSettings />

      <ThemeSettings />
    </div>
  );
}
