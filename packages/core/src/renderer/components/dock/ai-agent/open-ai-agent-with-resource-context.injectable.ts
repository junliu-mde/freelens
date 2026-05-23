/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { runInAction } from "mobx";
import hostedClusterIdInjectable from "../../../cluster-frame-context/hosted-cluster-id.injectable";
import createAiAgentTabInjectable from "./create-ai-agent-tab.injectable";
import aiAgentTabStoreInjectable from "./store.injectable";

import type { KubeObject } from "@freelensapp/kube-object";

import type { TabId } from "../dock/store";

const buildResourceContextDraft = (object: KubeObject): string => {
  let resourceJson: string;

  try {
    resourceJson = JSON.stringify(object.toPlainObject(), null, 2);
  } catch {
    resourceJson = "<unable to serialize resource>";
  }

  return ["```json", resourceJson, "```"].join("\n");
};

const openAiAgentWithResourceContextInjectable = getInjectable({
  id: "open-ai-agent-with-resource-context",

  instantiate: (di) => {
    const createAiAgentTab = di.inject(createAiAgentTabInjectable);
    const aiAgentTabStore = di.inject(aiAgentTabStoreInjectable);
    const hostedClusterId = di.inject(hostedClusterIdInjectable);

    return (object: KubeObject): TabId => {
      const name = object.getName();
      const namespace = object.getNs();
      const title = namespace ? `AI: ${object.kind}/${namespace}/${name}` : `AI: ${object.kind}/${name}`;

      return runInAction(() => {
        const tab = createAiAgentTab({ title });

        aiAgentTabStore.initTab(tab.id);

        if (hostedClusterId) {
          aiAgentTabStore.setClusterId(tab.id, hostedClusterId);
        }

        aiAgentTabStore.setInputDraft(tab.id, buildResourceContextDraft(object));

        return tab.id;
      });
    };
  },
});

export default openAiAgentWithResourceContextInjectable;
