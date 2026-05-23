/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { preferenceItemInjectionToken } from "../../preference-item-injection-token";
import { AiAgentPreferences } from "./ai-agent-preferences";

const aiAgentPreferenceBlockInjectable = getInjectable({
  id: "ai-agent-preference-item",

  instantiate: () => ({
    kind: "block" as const,
    id: "ai-agent",
    parentId: "ai-agent-page",
    orderNumber: 10,
    Component: AiAgentPreferences,
  }),

  injectionToken: preferenceItemInjectionToken,
});

export default aiAgentPreferenceBlockInjectable;
