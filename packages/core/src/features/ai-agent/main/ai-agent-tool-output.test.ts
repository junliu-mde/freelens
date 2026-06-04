/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import {
  AiAgentOutputAccumulator,
  createAiAgentToolExecutionPayload,
  truncateToolOutputTail,
} from "./ai-agent-tool-output";

describe("ai-agent tool output", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not truncate short output", () => {
    const payload = createAiAgentToolExecutionPayload("kubectl get pods", "pod-a\npod-b");

    expect(payload).toEqual({
      content: "pod-a\npod-b",
      details: {
        command: "kubectl get pods",
      },
    });
  });

  it("truncates large output and keeps the full output path", () => {
    const payload = createAiAgentToolExecutionPayload(
      "kubectl logs pod-a",
      Array.from({ length: 3_500 }, (_, index) => `line-${index}`).join("\n"),
    );

    expect(payload.details?.truncation?.truncated).toBe(true);
    expect(payload.details?.fullOutputPath).toBeDefined();
    expect(payload.content).toContain("Full output:");

    const fullOutputPath = payload.details?.fullOutputPath;

    expect(fullOutputPath && existsSync(fullOutputPath)).toBe(true);

    if (fullOutputPath) {
      expect(readFileSync(fullOutputPath, "utf-8")).toContain("line-3499");
      unlinkSync(fullOutputPath);
    }
  });

  it("matches oh-my-pi's 3000-line default tail window", () => {
    const result = truncateToolOutputTail(Array.from({ length: 3_500 }, (_, index) => `line-${index}`).join("\n"));

    expect(result.truncated).toBe(true);
    expect(result.outputLines).toBe(3_000);
    expect(result.content.startsWith("line-500\n")).toBe(true);
    expect(result.content.endsWith("line-3499")).toBe(true);
  });

  it("walks large output from the tail without splitting every line", () => {
    const originalSplit = String.prototype.split;
    const output = Array.from({ length: 3_500 }, (_, index) => `line-${index}`).join("\n");
    const splitSpy = jest.spyOn(String.prototype, "split").mockImplementation(function (
      this: string,
      separator,
      limit,
    ) {
      if (String(this) === output) {
        throw new Error("unexpected full-output split");
      }

      return Reflect.apply(originalSplit, this, [separator, limit]) as string[];
    });

    try {
      const result = truncateToolOutputTail(output);

      expect(result.outputLines).toBe(3_000);
      expect(result.content.startsWith("line-500\n")).toBe(true);
    } finally {
      splitSpy.mockRestore();
    }
  });

  it("counts trailing newline output like oh-my-pi", () => {
    const result = truncateToolOutputTail("line-1\nline-2\n");

    expect(result).toMatchObject({
      truncated: false,
      totalLines: 3,
      outputLines: 3,
    });
  });

  it("truncates a single oversized line from a bounded tail window", () => {
    const result = truncateToolOutputTail("你好".repeat(30_000));

    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
    expect(result.outputLines).toBe(1);
    expect(result.outputBytes).toBeLessThanOrEqual(50 * 1024);
    expect(result.content.includes("\ufffd")).toBe(false);
  });

  it("reports true full-output totals from a snapshot even after the rolling tail is trimmed", () => {
    const accumulator = new AiAgentOutputAccumulator();
    const totalLines = 100_000;

    // Many short lines: the rolling tail only retains a trailing window, but the running
    // line counter must still reflect the real total in the snapshot's truncation details.
    for (let index = 0; index < totalLines; index += 1) {
      accumulator.append(Buffer.from(`line-${index}\n`, "utf-8"));
    }

    accumulator.finish();

    const snapshot = accumulator.snapshot();

    expect(snapshot.truncation.truncated).toBe(true);
    expect(snapshot.truncation.totalLines).toBe(totalLines);
    expect(snapshot.truncation.totalLines).toBeGreaterThan(snapshot.truncation.outputLines);
  });

  it("truncates from the tail without returning partial utf8 bytes", () => {
    const result = truncateToolOutputTail("a\nb\n你好\n世界", 2, 8);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("世界");
    expect(result.content.includes("\ufffd")).toBe(false);
  });
});
