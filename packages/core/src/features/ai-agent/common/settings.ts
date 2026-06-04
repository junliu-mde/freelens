export type AiAgentReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const toPositiveInteger = (value: unknown, fallback: number, minimum = 1) => {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(numeric));
};

const toOptionalFiniteNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numeric = Number(value);

  // Drop non-numeric/corrupt values (e.g. a manually-edited config) so we never forward
  // `temperature: NaN` into the model stream request, which the endpoint would reject.
  return Number.isFinite(numeric) ? numeric : undefined;
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
  enableMcpTools: boolean;
  mcpConfigPath: string;
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
  enableMcpTools: true,
  mcpConfigPath: "~/.mcp.json",
  maxToolIterations: 5,
  enableCompaction: true,
  compactionReserveTokens: 16_384,
  compactionKeepRecentTokens: 20_000,
};

export const normalizeAiAgentSettings = (settings?: Partial<AiAgentSettings>): AiAgentSettings => ({
  ...defaultAiAgentSettings,
  ...settings,
  mcpConfigPath: settings?.mcpConfigPath?.trim() ?? defaultAiAgentSettings.mcpConfigPath,
  maxTokens: toPositiveInteger(settings?.maxTokens, defaultAiAgentSettings.maxTokens),
  temperature: toOptionalFiniteNumber(settings?.temperature),
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
