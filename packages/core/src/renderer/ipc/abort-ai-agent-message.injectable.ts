/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { aiAgentAbortChannel } from "../../features/ai-agent/common/channels";
import ipcRendererInjectable from "../utils/channel/ipc-renderer.injectable";

export type AbortAiAgentMessage = (tabId: string, runId: string) => void;

const abortAiAgentMessageInjectable = getInjectable({
  id: "abort-ai-agent-message",

  instantiate: (di): AbortAiAgentMessage => {
    const ipcRenderer = di.inject(ipcRendererInjectable);

    return (tabId, runId) => {
      ipcRenderer.send(aiAgentAbortChannel, tabId, runId);
    };
  },
});

export default abortAiAgentMessageInjectable;
