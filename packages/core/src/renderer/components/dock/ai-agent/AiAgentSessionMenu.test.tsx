/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { AiAgentSessionMenu } from "./AiAgentSessionMenu";

import type { UserEvent } from "@testing-library/user-event";

jest.mock("@freelensapp/icon", () => ({
  Icon: ({ material }: { material?: string }) => <span>{material}</span>,
}));

describe("<AiAgentSessionMenu />", () => {
  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup();
  });

  it("supports search, switch, rename, and delete actions", async () => {
    const onClose = jest.fn();
    const onDelete = jest.fn();
    const onNewSession = jest.fn();
    const onRename = jest.fn();
    const onSearch = jest.fn();
    const onSwitch = jest.fn();

    render(
      <AiAgentSessionMenu
        onClose={onClose}
        onDelete={onDelete}
        onNewSession={onNewSession}
        onRename={onRename}
        onSearch={onSearch}
        onSwitch={onSwitch}
        open={true}
        search=""
        sessions={[
          {
            id: "session-1",
            title: "GPU incident",
            updatedAt: Date.now(),
            turnCount: 3,
            clusterLabel: "cluster-a",
            searchText: "gpu incident inspect",
            active: true,
          },
        ]}
      />,
    );

    await user.type(screen.getByPlaceholderText("Search sessions"), "gpu");
    await user.click(screen.getByRole("button", { name: /gpu incident/i }));
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const renameInput = screen.getByDisplayValue("GPU incident");

    await user.clear(renameInput);
    await user.type(renameInput, "GPU incident renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onSearch).toHaveBeenCalled();
    expect(onSwitch).toHaveBeenCalledWith("session-1");
    expect(onRename).toHaveBeenCalledWith("session-1", "GPU incident renamed");
    expect(onDelete).toHaveBeenCalledWith("session-1");
    expect(onClose).not.toHaveBeenCalled();
  });
});
