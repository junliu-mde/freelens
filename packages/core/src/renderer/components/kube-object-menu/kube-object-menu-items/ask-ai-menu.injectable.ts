/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { kubeObjectMenuItemInjectionToken } from "../kube-object-menu-item-injection-token";
import { AskAiMenu } from "./ask-ai-menu";

import type { KubeObjectMenuItemComponent } from "../kube-object-menu-item-injection-token";

const askAiMenuInjectable = getInjectable({
  id: "ask-ai-menu-kube-object-menu",

  instantiate: () => ({
    kind: "*",
    apiVersions: ["*"],
    Component: AskAiMenu as KubeObjectMenuItemComponent,
    enabled: computed(() => true),
    orderNumber: 1,
  }),

  injectionToken: kubeObjectMenuItemInjectionToken,
});

export default askAiMenuInjectable;
