/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { aiAgentListModelsChannel } from "../../features/ai-agent/common/models-channel";
import ipcRendererInjectable from "../utils/channel/ipc-renderer.injectable";

import type { AiAgentListModelsRequest, AiAgentModelInfo } from "../../features/ai-agent/common/models-channel";

export type ListAiAgentModels = (request: AiAgentListModelsRequest) => Promise<AiAgentModelInfo[]>;

const listAiAgentModelsInjectable = getInjectable({
  id: "list-ai-agent-models",

  instantiate: (di): ListAiAgentModels => {
    const ipcRenderer = di.inject(ipcRendererInjectable);

    return (request) => ipcRenderer.invoke(aiAgentListModelsChannel, request);
  },
});

export default listAiAgentModelsInjectable;
