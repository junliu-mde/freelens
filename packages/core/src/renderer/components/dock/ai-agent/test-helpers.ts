/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import isEqual from "lodash/isEqual";

import type { CreateStorage } from "../../../utils/create-storage/create-storage.injectable";
import type { StorageLayer } from "../../../utils/storage-helper";

export const createMockStorage = (): CreateStorage => {
  const storage = new Map<string, unknown>();

  return <T>(key: string, defaultValue: T): StorageLayer<T> => ({
    isDefaultValue: (value: T) => isEqual(value, defaultValue),
    get: () => (storage.has(key) ? (storage.get(key) as T) : defaultValue),
    set: (value: T) => {
      if (isEqual(value, defaultValue)) {
        storage.delete(key);

        return;
      }

      storage.set(key, value);
    },
    reset: () => {
      storage.delete(key);
    },
    merge: (value) => {
      const currentValue = storage.has(key) ? (storage.get(key) as T) : defaultValue;

      if (typeof value === "function") {
        const nextValue = { ...(currentValue as object) } as T;
        const partialValue = value(nextValue as never);

        storage.set(key, { ...nextValue, ...(partialValue ?? {}) });

        return;
      }

      storage.set(key, { ...(currentValue as object), ...(value as object) });
    },
  });
};
