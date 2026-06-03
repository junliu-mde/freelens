/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observable } from "mobx";
import { ClusterFrameHandler } from "./cluster-frame-handler";

describe("ClusterFrameHandler", () => {
  const createHandler = () => {
    const cluster = {
      available: observable.box(true),
      ready: observable.box(true),
    };
    const emitClusterVisibility = jest.fn();
    const frame = document.createElement("iframe");

    frame.focus = jest.fn();
    document.body.innerHTML = '<div id="lens-views"></div>';

    const handler = new ClusterFrameHandler({
      emitClusterVisibility,
      getClusterById: jest.fn(() => cluster as any),
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
      } as any,
    });

    (handler as any).views.set("cluster-1", {
      frame,
      isLoaded: true,
    });

    return { emitClusterVisibility, frame, handler };
  };

  it("keeps dock focus when showing a cluster while the dock already owns focus", () => {
    const { frame, handler } = createHandler();
    const dock = document.createElement("div");

    dock.className = "Dock";
    dock.tabIndex = -1;
    document.body.appendChild(dock);
    dock.focus();

    handler.setVisibleCluster("cluster-1" as any);

    expect(frame.focus).not.toHaveBeenCalled();
  });

  it("focuses the cluster frame when no interactive root-frame element is focused", () => {
    const { frame, handler } = createHandler();

    handler.setVisibleCluster("cluster-1" as any);

    expect(frame.focus).toHaveBeenCalledTimes(1);
  });
});
