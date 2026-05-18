/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { action } from "mobx";
import userPreferencesStateInjectable from "./state.injectable";

export type GetTableColumnOrder = (tableId: string) => string[] | undefined;

export const getTableColumnOrderInjectable = getInjectable({
  id: "get-table-column-order",
  instantiate: (di): GetTableColumnOrder => {
    const state = di.inject(userPreferencesStateInjectable);

    return (tableId) => state.tableColumnOrder.get(tableId);
  },
});

export type SetTableColumnOrder = (tableId: string, columnIds: string[]) => void;

export const setTableColumnOrderInjectable = getInjectable({
  id: "set-table-column-order",
  instantiate: (di): SetTableColumnOrder => {
    const state = di.inject(userPreferencesStateInjectable);

    return action((tableId, columnIds) => {
      state.tableColumnOrder.set(tableId, columnIds);
    });
  },
});
