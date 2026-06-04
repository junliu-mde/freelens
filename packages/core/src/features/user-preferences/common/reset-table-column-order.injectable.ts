/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { action } from "mobx";
import userPreferencesStateInjectable from "./state.injectable";

export type ResetTableColumnOrder = (tableId: string) => void;

const resetTableColumnOrderInjectable = getInjectable({
  id: "reset-table-column-order",
  instantiate: (di): ResetTableColumnOrder => {
    const state = di.inject(userPreferencesStateInjectable);

    return action((tableId) => {
      // Guarded like the sibling get/set helpers: tableColumnOrder is undefined until the
      // user-preferences store hydrates, so a reset triggered before then must be a no-op
      // rather than throwing "Cannot read properties of undefined (reading 'delete')".
      state.tableColumnOrder?.delete(tableId);
    });
  },
});

export default resetTableColumnOrderInjectable;
