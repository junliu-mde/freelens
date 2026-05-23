/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import aiAgentTabStoreInjectable from "./store.injectable";

import type { TabId } from "../dock/store";

const clearAiAgentTabDataInjectable = getInjectable({
  id: "clear-ai-agent-tab-data",

  instantiate: (di) => {
    const aiAgentTabStore = di.inject(aiAgentTabStoreInjectable);

    return (tabId: TabId): void => {
      aiAgentTabStore.clearData(tabId);
    };
  },
});

export default clearAiAgentTabDataInjectable;
