export type AiAgentReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const toPositiveInteger = (value: unknown, fallback: number, minimum = 1) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(numeric));
};

export interface AiAgentSettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: AiAgentReasoningEffort;
  maxTokens: number;
  temperature?: number;
  enableKubectlTools: boolean;
  maxToolIterations: number;
  enableCompaction: boolean;
  compactionReserveTokens: number;
  compactionKeepRecentTokens: number;
}

export const defaultAiAgentSettings: AiAgentSettings = {
  provider: "custom-openai-compat",
  baseUrl: "",
  apiKey: "",
  model: "",
  reasoningEffort: "medium",
  maxTokens: 4096,
  temperature: undefined,
  enableKubectlTools: true,
  maxToolIterations: 5,
  enableCompaction: true,
  compactionReserveTokens: 16_384,
  compactionKeepRecentTokens: 20_000,
};

export const normalizeAiAgentSettings = (settings?: Partial<AiAgentSettings>): AiAgentSettings => ({
  ...defaultAiAgentSettings,
  ...settings,
  maxTokens: toPositiveInteger(settings?.maxTokens, defaultAiAgentSettings.maxTokens),
  temperature: settings?.temperature !== undefined ? Number(settings?.temperature) : undefined,
  maxToolIterations: toPositiveInteger(settings?.maxToolIterations, defaultAiAgentSettings.maxToolIterations, 0),
  compactionReserveTokens: toPositiveInteger(
    settings?.compactionReserveTokens,
    defaultAiAgentSettings.compactionReserveTokens,
  ),
  compactionKeepRecentTokens: toPositiveInteger(
    settings?.compactionKeepRecentTokens,
    defaultAiAgentSettings.compactionKeepRecentTokens,
  ),
});
