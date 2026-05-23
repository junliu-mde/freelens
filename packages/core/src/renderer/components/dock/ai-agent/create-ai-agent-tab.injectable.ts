/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { TabKind } from "../dock/store";
import dockStoreInjectable from "../dock/store.injectable";

import type { DockTabCreateSpecific } from "../dock/store";

const createAiAgentTabInjectable = getInjectable({
  id: "create-ai-agent-tab",

  instantiate: (di) => {
    const dockStore = di.inject(dockStoreInjectable);

    return (tabParams: DockTabCreateSpecific = {}) =>
      dockStore.createTab({
        title: "AI Agent",
        ...tabParams,
        kind: TabKind.AI_AGENT,
      });
  },
});

export default createAiAgentTabInjectable;
