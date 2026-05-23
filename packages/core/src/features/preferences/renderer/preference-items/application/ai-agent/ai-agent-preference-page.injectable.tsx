/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import React from "react";
import { PreferencePageComponent } from "../../../preference-page-component";
import { preferenceItemInjectionToken } from "../../preference-item-injection-token";

import type { PreferenceItemComponent, PreferencePage } from "../../preference-item-injection-token";

const AiAgentPage: PreferenceItemComponent<PreferencePage> = ({ children, item }) => (
  <PreferencePageComponent title="AI Agent" id={item.id}>
    {children}
  </PreferencePageComponent>
);

const aiAgentPreferencePageInjectable = getInjectable({
  id: "ai-agent-preference-page",

  instantiate: () => ({
    kind: "page" as const,
    id: "ai-agent-page",
    parentId: "ai-agent-tab",
    Component: AiAgentPage,
  }),

  injectionToken: preferenceItemInjectionToken,
});

export default aiAgentPreferencePageInjectable;
