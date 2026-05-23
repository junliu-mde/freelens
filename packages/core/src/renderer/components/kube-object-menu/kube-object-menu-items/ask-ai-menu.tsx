/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { withInjectables } from "@ogre-tools/injectable-react";
import React from "react";
import openAiAgentWithResourceContextInjectable from "../../dock/ai-agent/open-ai-agent-with-resource-context.injectable";
import hideDetailsInjectable from "../../kube-detail-params/hide-details.injectable";
import { MenuItem } from "../../menu";

import type { KubeObject } from "@freelensapp/kube-object";

import type { HideDetails } from "../../kube-detail-params/hide-details.injectable";
import type { KubeObjectMenuProps } from "../kube-object-menu";

export interface AskAiMenuProps extends KubeObjectMenuProps<KubeObject> {}

interface Dependencies {
  hideDetails: HideDetails;
  openAiAgentWithResourceContext: (object: KubeObject) => string;
}

const NonInjectedAskAiMenu: React.FC<AskAiMenuProps & Dependencies> = ({
  object,
  toolbar,
  hideDetails,
  openAiAgentWithResourceContext,
}) => {
  if (!object) return null;

  const onClick = () => {
    openAiAgentWithResourceContext(object);
    hideDetails();
  };

  return (
    <MenuItem onClick={onClick}>
      <Icon material="smart_toy" interactive={toolbar} tooltip="Ask AI" />
      <span className="title">Ask AI</span>
    </MenuItem>
  );
};

export const AskAiMenu = withInjectables<Dependencies, AskAiMenuProps>(NonInjectedAskAiMenu, {
  getProps: (di, props) => ({
    ...props,
    hideDetails: di.inject(hideDetailsInjectable),
    openAiAgentWithResourceContext: di.inject(openAiAgentWithResourceContextInjectable),
  }),
});
