/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

export const Type = {
  Object: (value: any) => value,
  String: (value: any) => value,
  Optional: (value: any) => value,
  Union: (value: any) => value,
  Literal: (value: any) => value,
  Boolean: (value: any) => value,
  Number: (value: any) => value,
  Array: (value: any) => value,
};

export const completeSimple = jest.fn();
export const stream = jest.fn();
export const validateToolCall = jest.fn();
