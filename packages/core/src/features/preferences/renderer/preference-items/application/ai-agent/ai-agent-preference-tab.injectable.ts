/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { preferenceItemInjectionToken } from "../../preference-item-injection-token";

const aiAgentPreferenceTabInjectable = getInjectable({
  id: "ai-agent-preference-tab",

  instantiate: () => ({
    kind: "tab" as const,
    id: "ai-agent-tab",
    parentId: "general-tab-group" as const,
    pathId: "ai-agent",
    label: "AI Agent",
    orderNumber: 15,
  }),

  injectionToken: preferenceItemInjectionToken,
});

export default aiAgentPreferenceTabInjectable;
