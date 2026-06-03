/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { pickDeploymentListCondition } from "./utils";

import type { Condition } from "@freelensapp/kube-object/dist";

function condition(type: string, status: string): Condition {
  return {
    type,
    status,
    lastTransitionTime: "2026-05-21T08:17:46Z",
    lastUpdateTime: "2026-05-21T08:17:46Z",
    reason: "Test",
    message: "Test",
  };
}

describe("pickDeploymentListCondition", () => {
  it("prefers Available when both Available and Progressing are True", () => {
    const picked = pickDeploymentListCondition([condition("Progressing", "True"), condition("Available", "True")]);

    expect(picked?.type).toBe("Available");
  });

  it("shows Progressing when Available is False and Progressing is True", () => {
    const picked = pickDeploymentListCondition([condition("Available", "False"), condition("Progressing", "True")]);

    expect(picked?.type).toBe("Progressing");
  });

  it("shows Available when it is False and Progressing is absent", () => {
    const picked = pickDeploymentListCondition([condition("Available", "False")]);

    expect(picked?.type).toBe("Available");
  });
});
