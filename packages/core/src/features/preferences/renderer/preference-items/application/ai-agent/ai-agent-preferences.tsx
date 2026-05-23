/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import React, { useState } from "react";
import { normalizeAiAgentSettings } from "../../../../../../features/ai-agent/common/settings";
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
      <SubTitle title="AI Agent" />

      <label>Provider</label>
      <Select
        id="ai-agent-provider-input"
        options={providerOptions}
        value={settings.provider}
        onChange={(option) => updateSettings({ provider: option?.value ?? "custom-openai-compat" })}
        themeName="lens"
      />

      <label>Base URL</label>
      <Input
        theme="round-black"
        value={settings.baseUrl}
        onChange={(baseUrl) => updateSettings({ baseUrl })}
        placeholder="https://api.example.com/v1"
      />

      <label>API key</label>
      <Input
        theme="round-black"
        type="password"
        value={settings.apiKey}
        onChange={(apiKey) => updateSettings({ apiKey })}
        placeholder="sk-..."
      />

      <label>Model</label>
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

      <label>Reasoning effort</label>
      <Select
        id="ai-agent-reasoning-effort-input"
        options={reasoningOptions}
        value={settings.reasoningEffort}
        onChange={(option) => updateSettings({ reasoningEffort: option?.value ?? "medium" })}
        themeName="lens"
      />

      <label>Max output tokens</label>
      <Input
        theme="round-black"
        value={String(settings.maxTokens)}
        validators={InputValidators.isNumber}
        onChange={(value) => updateSettings({ maxTokens: Number(value) || settings.maxTokens })}
      />

      <label>Temperature</label>
      <Input
        theme="round-black"
        value={settings.temperature === undefined ? "" : String(settings.temperature)}
        onChange={(value) => updateSettings({ temperature: value.trim() ? Number(value) : undefined })}
        placeholder="Provider default"
      />

      <Switch
        checked={settings.enableKubectlTools}
        onChange={() => updateSettings({ enableKubectlTools: !settings.enableKubectlTools })}
      >
        Enable kubectl tools for the active cluster
      </Switch>
      <div className="hint">
        The agent can run read-only kubectl commands against the active cluster via Freelens auth proxy.
      </div>

      <label>Max tool iterations</label>
      <Input
        theme="round-black"
        value={String(settings.maxToolIterations)}
        validators={InputValidators.isNumber}
        onChange={(value) => updateSettings({ maxToolIterations: Number(value) || settings.maxToolIterations })}
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
