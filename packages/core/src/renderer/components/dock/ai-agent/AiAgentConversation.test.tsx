/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import React from "react";
import { AiAgentConversation } from "./AiAgentConversation";

import type { AiAgentMessageCardViewModel } from "./view-model";

jest.mock("@freelensapp/icon", () => ({
  Icon: ({ material }: { material?: string }) => <span>{material}</span>,
}));

const messages: AiAgentMessageCardViewModel[] = [
  {
    id: "assistant-1",
    kind: "assistant",
    label: "agent",
    status: "done",
    createdAt: 1,
    blocks: [{ type: "text", id: "text-1", text: "hello" }],
    showStreamingPlaceholder: false,
    streamingPlaceholderText: "",
  },
];

describe("<AiAgentConversation />", () => {
  let scrollIntoViewMock: jest.Mock;

  beforeEach(() => {
    scrollIntoViewMock = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;
  });

  it("auto-scrolls when new content arrives and the user is near the bottom", () => {
    const onScrollStateChange = jest.fn();
    const result = render(
      <AiAgentConversation
        tabId="tab-id"
        conversationVersion="v1"
        hasUnreadBelow={false}
        isNearBottom={true}
        messages={messages}
        onContinue={jest.fn()}
        onCopyPath={jest.fn()}
        onCopySummary={jest.fn()}
        onOpenFullOutput={jest.fn()}
        onRetry={jest.fn()}
        onScrollStateChange={onScrollStateChange}
      />,
    );

    scrollIntoViewMock.mockClear();
    onScrollStateChange.mockClear();

    result.rerender(
      <AiAgentConversation
        tabId="tab-id"
        conversationVersion="v2"
        hasUnreadBelow={false}
        isNearBottom={true}
        messages={[
          {
            ...messages[0],
            blocks: [{ type: "text", id: "text-2", text: "updated" }],
          },
        ]}
        onContinue={jest.fn()}
        onCopyPath={jest.fn()}
        onCopySummary={jest.fn()}
        onOpenFullOutput={jest.fn()}
        onRetry={jest.fn()}
        onScrollStateChange={onScrollStateChange}
      />,
    );

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(onScrollStateChange).toHaveBeenCalledWith({
      hasUnreadBelow: false,
      isNearBottom: true,
    });
  });

  it("marks unread output instead of jumping when the user is away from the bottom", () => {
    const onScrollStateChange = jest.fn();
    const result = render(
      <AiAgentConversation
        tabId="tab-id"
        conversationVersion="v1"
        hasUnreadBelow={true}
        isNearBottom={false}
        lastCompactionAt={Date.now()}
        lastCompactionSummaryPreview="## Goal"
        messages={messages}
        onContinue={jest.fn()}
        onCopyPath={jest.fn()}
        onCopySummary={jest.fn()}
        onOpenFullOutput={jest.fn()}
        onRetry={jest.fn()}
        onScrollStateChange={onScrollStateChange}
      />,
    );

    onScrollStateChange.mockClear();

    result.rerender(
      <AiAgentConversation
        tabId="tab-id"
        conversationVersion="v2"
        hasUnreadBelow={true}
        isNearBottom={false}
        lastCompactionAt={Date.now()}
        lastCompactionSummaryPreview="## Goal"
        messages={messages}
        onContinue={jest.fn()}
        onCopyPath={jest.fn()}
        onCopySummary={jest.fn()}
        onOpenFullOutput={jest.fn()}
        onRetry={jest.fn()}
        onScrollStateChange={onScrollStateChange}
      />,
    );

    expect(onScrollStateChange).toHaveBeenCalledWith({ hasUnreadBelow: true });
    expect(result.getByText(/New output.*Jump to latest/)).toBeInTheDocument();
  });

  it("does not show the jump button for an empty conversation", () => {
    const { queryByText } = render(
      <AiAgentConversation
        tabId="tab-id"
        conversationVersion="v1"
        hasUnreadBelow={true}
        isNearBottom={false}
        messages={[]}
        onContinue={jest.fn()}
        onCopyPath={jest.fn()}
        onCopySummary={jest.fn()}
        onOpenFullOutput={jest.fn()}
        onRetry={jest.fn()}
        onScrollStateChange={jest.fn()}
      />,
    );

    expect(queryByText(/New output.*Jump to latest/)).not.toBeInTheDocument();
  });
});
