export type AiAgentReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

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
};

export const normalizeAiAgentSettings = (settings?: Partial<AiAgentSettings>): AiAgentSettings => ({
  ...defaultAiAgentSettings,
  ...settings,
  maxTokens: Number.isFinite(settings?.maxTokens) ? Number(settings?.maxTokens) : defaultAiAgentSettings.maxTokens,
  temperature: settings?.temperature !== undefined ? Number(settings?.temperature) : undefined,
  maxToolIterations: Number.isFinite(settings?.maxToolIterations)
    ? Number(settings?.maxToolIterations)
    : defaultAiAgentSettings.maxToolIterations,
});
