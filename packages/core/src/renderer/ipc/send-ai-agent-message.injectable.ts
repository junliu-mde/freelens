/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { toJS } from "../../common/utils";
import { aiAgentSendChannel } from "../../features/ai-agent/common/channels";
import { aiAgentClusterIdHeader } from "../../features/ai-agent/common/headers";
import hostedClusterIdInjectable from "../cluster-frame-context/hosted-cluster-id.injectable";
import ipcRendererInjectable from "../utils/channel/ipc-renderer.injectable";

import type { AiAgentSendRequest } from "../../features/ai-agent/common/channels";

export type SendAiAgentMessage = (request: AiAgentSendRequest) => Promise<void>;

const sendAiAgentMessageInjectable = getInjectable({
  id: "send-ai-agent-message",

  instantiate: (di): SendAiAgentMessage => {
    const ipcRenderer = di.inject(ipcRendererInjectable);
    const hostedClusterId = di.inject(hostedClusterIdInjectable);

    return async (request) => {
      await ipcRenderer.invoke(
        aiAgentSendChannel,
        toJS({
          ...request,
          metadata: {
            [aiAgentClusterIdHeader]: hostedClusterId,
          },
        }),
      );
    };
  },
});

export default sendAiAgentMessageInjectable;
