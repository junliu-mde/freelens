/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import React, { useState } from "react";
import { normalizeAiAgentSettings } from "../../../../../../features/ai-agent/common/settings";
import { Gutter } from "../../../../../../renderer/components/gutter";
import { Input, InputValidators } from "../../../../../../renderer/components/input";
import { SubTitle } from "../../../../../../renderer/components/layout/sub-title";
import { Select } from "../../../../../../renderer/components/select";
import { Switch } from "../../../../../../renderer/components/switch";
import listAiAgentModelsInjectable from "../../../../../../renderer/ipc/list-ai-agent-models.injectable";
import userPreferencesStateInjectable from "../../../../../user-preferences/common/state.injectable";

import type { AiAgentReasoningEffort } from "../../../../../../features/ai-agent/common/settings";
import type { ListAiAgentModels } from "../../../../../../renderer/ipc/list-ai-agent-models.injectable";
import type { UserPreferencesState } from "../../../../../user-preferences/common/state.injectable";

interface Dependencies {
  listAiAgentModels: ListAiAgentModels;
  state: UserPreferencesState;
}

const reasoningOptions: { value: AiAgentReasoningEffort; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

const providerOptions = [
  { value: "custom-openai-compat", label: "Custom OpenAI compatible" },
  { value: "openai", label: "OpenAI compatible" },
  { value: "deepseek", label: "DeepSeek compatible" },
  { value: "zai", label: "z.ai / GLM compatible" },
];

const NonInjectedAiAgentPreferences = observer(({ listAiAgentModels, state }: Dependencies) => {
  const settings = normalizeAiAgentSettings(state.aiAgent);
  const [modelOptions, setModelOptions] = useState([{ value: settings.model, label: settings.model }]);
  const [modelLoadError, setModelLoadError] = useState<string | undefined>();
  const [loadingModels, setLoadingModels] = useState(false);

  const updateSettings = (patch: Partial<typeof settings>) => {
    state.aiAgent = normalizeAiAgentSettings({
      ...settings,
      ...patch,
    });
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setModelLoadError(undefined);

    try {
      const models = await listAiAgentModels({ baseUrl: settings.baseUrl, apiKey: settings.apiKey });
      const options = models.map((model) => ({ value: model.id, label: model.name ?? model.id }));

      setModelOptions(options.length > 0 ? options : [{ value: settings.model, label: settings.model }]);
    } catch (error) {
      setModelLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingModels(false);
    }
  };

  return (
    <section id="ai-agent-settings">
      <SubTitle title="Provider" />
      <Select
        id="ai-agent-provider-input"
        options={providerOptions}
        value={settings.provider}
        onChange={(option) => updateSettings({ provider: option?.value ?? "custom-openai-compat" })}
        themeName="lens"
      />
      <Gutter size="xl" />

      <SubTitle title="Base URL" />
      <Input
        theme="round-black"
        value={settings.baseUrl}
        onChange={(baseUrl) => updateSettings({ baseUrl })}
        placeholder="https://api.example.com/v1"
      />
      <Gutter size="xl" />

      <SubTitle title="API key" />
      <Input
        theme="round-black"
        type="password"
        value={settings.apiKey}
        onChange={(apiKey) => updateSettings({ apiKey })}
        placeholder="sk-..."
      />
      <Gutter size="xl" />

      <SubTitle title="Model" />
      <div className="flex gaps align-center">
        <div className="box grow">
          <Select
            id="ai-agent-model-input"
            options={modelOptions}
            value={settings.model}
            onChange={(option) => updateSettings({ model: option?.value ?? settings.model })}
            themeName="lens"
          />
        </div>
        <button type="button" onClick={loadModels} disabled={loadingModels || !settings.baseUrl}>
          {loadingModels ? "Loading..." : "Load /v1/models"}
        </button>
      </div>
      {modelLoadError ? <div className="hint error">{modelLoadError}</div> : null}
      <Gutter size="xl" />

      <SubTitle title="Reasoning effort" />
      <Select
        id="ai-agent-reasoning-effort-input"
        options={reasoningOptions}
        value={settings.reasoningEffort}
        onChange={(option) => updateSettings({ reasoningEffort: option?.value ?? "medium" })}
        themeName="lens"
      />
      <Gutter size="xl" />

      <SubTitle title="Temperature" />
      <Input
        theme="round-black"
        value={settings.temperature === undefined ? "" : String(settings.temperature)}
        validators={InputValidators.isNumber}
        onChange={(value) => {
          const numeric = Number(value);

          updateSettings({ temperature: value.trim() && Number.isFinite(numeric) ? numeric : undefined });
        }}
        placeholder="Provider default"
      />
      <Gutter size="xl" />

      <Switch
        checked={settings.enableKubectlTools}
        onChange={() => updateSettings({ enableKubectlTools: !settings.enableKubectlTools })}
      >
        Enable kubectl tools for the active cluster
      </Switch>
      <div className="hint">
        The agent can run read-only kubectl commands against the active cluster via Freelens auth proxy.
      </div>
      <Gutter size="xl" />

      <SubTitle title="MCP" />
      <Switch
        checked={settings.enableMcpTools}
        onChange={() => updateSettings({ enableMcpTools: !settings.enableMcpTools })}
      >
        Enable MCP tools from config file
      </Switch>
      <div className="hint">When enabled, Freelens loads MCP servers and makes their tools available in chat.</div>
      <Gutter size="xl" />

      <SubTitle title="MCP config path" />
      <Input
        theme="round-black"
        value={settings.mcpConfigPath}
        onChange={(mcpConfigPath) => updateSettings({ mcpConfigPath })}
        placeholder="~/.mcp.json"
        disabled={!settings.enableMcpTools}
      />
      <div className="hint">
        Default path: <code>~/.mcp.json</code>
      </div>
      <div className="hint">
        Freelens reads the <code>mcpServers</code> object in that file. Local servers can use <code>command</code>,{" "}
        <code>args</code>, <code>env</code>, and <code>cwd</code>. Remote servers can use <code>url</code>, and can also
        set <code>transport</code> or <code>headers</code>.
      </div>
      <Gutter size="xl" />

      <SubTitle title="Max tool iterations" />
      <Input
        theme="round-black"
        value={String(settings.maxToolIterations)}
        validators={InputValidators.isNumber}
        onChange={(value) => updateSettings({ maxToolIterations: Number(value) || settings.maxToolIterations })}
      />
      <Gutter size="xl" />

      <Switch
        checked={settings.enableCompaction}
        onChange={() => updateSettings({ enableCompaction: !settings.enableCompaction })}
      >
        Automatically compact long chat history
      </Switch>
      <div className="hint">
        When the context gets too large, older turns are summarized and recent turns stay verbatim.
      </div>
      <Gutter size="xl" />

      <SubTitle title="Compaction reserve tokens" />
      <Input
        theme="round-black"
        value={String(settings.compactionReserveTokens)}
        validators={InputValidators.isNumber}
        onChange={(value) =>
          updateSettings({ compactionReserveTokens: Number(value) || settings.compactionReserveTokens })
        }
        disabled={!settings.enableCompaction}
      />
      <Gutter size="xl" />

      <SubTitle title="Recent tokens to keep" />
      <Input
        theme="round-black"
        value={String(settings.compactionKeepRecentTokens)}
        validators={InputValidators.isNumber}
        onChange={(value) =>
          updateSettings({ compactionKeepRecentTokens: Number(value) || settings.compactionKeepRecentTokens })
        }
        disabled={!settings.enableCompaction}
      />
    </section>
  );
});

export const AiAgentPreferences = withInjectables<Dependencies>(NonInjectedAiAgentPreferences, {
  getProps: (di) => ({
    listAiAgentModels: di.inject(listAiAgentModelsInjectable),
    state: di.inject(userPreferencesStateInjectable),
  }),
});
