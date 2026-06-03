/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import ipcRendererInjectable from "../../../utils/channel/ipc-renderer.injectable";
import createStorageInjectable from "../../../utils/create-storage/create-storage.injectable";
import { AiAgentTabStore } from "./store";

const aiAgentTabStoreInjectable = getInjectable({
  id: "ai-agent-tab-store",

  instantiate: (di) =>
    new AiAgentTabStore({
      createStorage: di.inject(createStorageInjectable),
      ipcRenderer: di.inject(ipcRendererInjectable),
    }),
});

export default aiAgentTabStoreInjectable;
