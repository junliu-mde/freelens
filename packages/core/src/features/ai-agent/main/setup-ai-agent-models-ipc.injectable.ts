/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { onLoadOfApplicationInjectionToken } from "@freelensapp/application";
import { getInjectable } from "@ogre-tools/injectable";
import { ipcMainHandle } from "../../../common/ipc";
import { aiAgentListModelsChannel } from "../common/models-channel";

import type { AiAgentListModelsRequest, AiAgentModelInfo } from "../common/models-channel";

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

const listAiAgentModels = async ({ baseUrl, apiKey }: AiAgentListModelsRequest): Promise<AiAgentModelInfo[]> => {
  if (!baseUrl) {
    return [];
  }

  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { data?: unknown[] };

  return (payload.data ?? []).flatMap((model): AiAgentModelInfo[] => {
    if (!model || typeof model !== "object" || !("id" in model) || typeof model.id !== "string") {
      return [];
    }

    return [
      {
        id: model.id,
        name: "name" in model && typeof model.name === "string" ? model.name : model.id,
      },
    ];
  });
};

const setupAiAgentModelsIpcInjectable = getInjectable({
  id: "setup-ai-agent-models-ipc",

  instantiate: () => ({
    run: () => {
      ipcMainHandle(aiAgentListModelsChannel, (_event, request: AiAgentListModelsRequest) =>
        listAiAgentModels(request),
      );
    },
  }),

  causesSideEffects: true,
  injectionToken: onLoadOfApplicationInjectionToken,
});

export default setupAiAgentModelsIpcInjectable;
