/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AiAgentToolResultDetails, AiAgentToolResultTruncation } from "../common/tool-result-details";

export const aiAgentToolMaxLines = 3_000;
export const aiAgentToolMaxBytes = 50 * 1024;

export interface AiAgentToolExecutionPayload {
  content: string;
  details?: AiAgentToolResultDetails;
}

export interface AiAgentToolOutputSnapshot {
  content: string;
  truncation: AiAgentToolResultTruncation;
  fullOutputPath?: string;
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes}B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
};

const countNewlines = (content: string) => {
  let count = 0;
  let position = content.indexOf("\n");

  while (position !== -1) {
    count += 1;
    position = content.indexOf("\n", position + 1);
  }

  return count;
};

const findUtf8BoundaryForward = (buffer: Buffer, position: number) => {
  let start = Math.max(0, position);

  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }

  return start;
};

const truncateStringToBytesFromEnd = (content: string, maxBytes: number) => {
  if (maxBytes === 0) {
    return { text: "", bytes: 0 };
  }

  if (content.length <= maxBytes) {
    const bytes = Buffer.byteLength(content, "utf-8");

    if (bytes <= maxBytes) {
      return { text: content, bytes };
    }
  }

  const window = content.substring(Math.max(0, content.length - maxBytes));
  const buffer = Buffer.from(window, "utf-8");
  let start = Math.max(0, buffer.length - maxBytes);

  start = findUtf8BoundaryForward(buffer, start);

  const slice = buffer.subarray(start);

  return { text: slice.toString("utf-8"), bytes: slice.length };
};

const byteLength = (content: string) => Buffer.byteLength(content, "utf-8");

export const truncateToolOutputTail = (
  content: string,
  maxLines = aiAgentToolMaxLines,
  maxBytes = aiAgentToolMaxBytes,
): AiAgentToolResultTruncation & { content: string } => {
  const totalBytes = Buffer.byteLength(content, "utf-8");
  const totalLines = content.length === 0 ? 0 : countNewlines(content) + 1;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      truncated: false,
      truncatedBy: null,
      totalLines,
      totalBytes,
      outputLines: totalLines,
      outputBytes: totalBytes,
      lastLinePartial: false,
      firstLineExceedsLimit: false,
      maxLines,
      maxBytes,
    };
  }

  let includedLines = 0;
  let outputBytes = 0;
  let truncatedBy: "lines" | "bytes" = "lines";
  let startIndex = content.length;
  let endIndex = content.length;

  while (includedLines < maxLines) {
    const newlineIndex = content.lastIndexOf("\n", endIndex - 1);
    const lineStart = newlineIndex === -1 ? 0 : newlineIndex + 1;
    const separatorBytes = includedLines > 0 ? 1 : 0;
    const remainingBytes = maxBytes - outputBytes - separatorBytes;

    if (remainingBytes < 0) {
      truncatedBy = "bytes";
      break;
    }

    const lineLength = endIndex - lineStart;

    if (lineLength > remainingBytes) {
      truncatedBy = "bytes";

      if (includedLines === 0) {
        const windowStart = Math.max(lineStart, endIndex - maxBytes);
        const truncatedLine = truncateStringToBytesFromEnd(content.substring(windowStart, endIndex), maxBytes);

        return {
          content: truncatedLine.text,
          truncated: true,
          truncatedBy,
          totalLines,
          totalBytes,
          outputLines: 1,
          outputBytes: truncatedLine.bytes,
          lastLinePartial: true,
          firstLineExceedsLimit: false,
          maxLines,
          maxBytes,
        };
      }

      break;
    }

    const line = content.slice(lineStart, endIndex);
    const lineBytes = Buffer.byteLength(line, "utf-8");

    if (lineBytes > remainingBytes) {
      truncatedBy = "bytes";

      if (includedLines === 0) {
        const truncatedLine = truncateStringToBytesFromEnd(line, maxBytes);

        return {
          content: truncatedLine.text,
          truncated: true,
          truncatedBy,
          totalLines,
          totalBytes,
          outputLines: 1,
          outputBytes: truncatedLine.bytes,
          lastLinePartial: true,
          firstLineExceedsLimit: false,
          maxLines,
          maxBytes,
        };
      }

      break;
    }

    outputBytes += separatorBytes + lineBytes;
    includedLines += 1;
    startIndex = lineStart;

    if (newlineIndex === -1) {
      break;
    }

    endIndex = newlineIndex;
  }

  if (includedLines >= maxLines && outputBytes <= maxBytes) {
    truncatedBy = "lines";
  }

  const truncatedContent = content.slice(startIndex);

  return {
    content: truncatedContent,
    truncated: true,
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines: includedLines,
    outputBytes,
    lastLinePartial: false,
    firstLineExceedsLimit: false,
    maxLines,
    maxBytes,
  };
};

const persistToolOutput = (content: string, command: string) => {
  const fileName = `freelens-ai-agent-${
    command
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "tool"
  }-${randomBytes(6).toString("hex")}.log`;
  const filePath = join(tmpdir(), fileName);

  writeFileSync(filePath, content, "utf-8");

  return filePath;
};

const createPayloadFromSnapshot = (
  command: string | undefined,
  snapshot: AiAgentToolOutputSnapshot,
): AiAgentToolExecutionPayload => {
  const { truncation } = snapshot;

  if (!truncation.truncated) {
    return {
      content: snapshot.content || "Command completed with no output.",
      details: command ? { command } : undefined,
    };
  }

  const details: AiAgentToolResultDetails = {
    ...(command ? { command } : {}),
    fullOutputPath: snapshot.fullOutputPath,
    truncation,
  };
  const lineStart = Math.max(1, truncation.totalLines - truncation.outputLines + 1);
  const lineEnd = truncation.totalLines;
  const notice = truncation.lastLinePartial
    ? `[Showing last ${formatSize(truncation.outputBytes)} of line ${lineEnd}. Full output: ${snapshot.fullOutputPath}]`
    : truncation.truncatedBy === "lines"
      ? `[Showing lines ${lineStart}-${lineEnd} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`
      : `[Showing lines ${lineStart}-${lineEnd} of ${truncation.totalLines} (${formatSize(truncation.maxBytes)} limit). Full output: ${snapshot.fullOutputPath}]`;

  return {
    content: `${snapshot.content}\n\n${notice}`.trim(),
    details,
  };
};

export class AiAgentOutputAccumulator {
  private readonly maxLines: number;
  private readonly maxBytes: number;
  private readonly maxRollingBytes: number;
  private readonly tempFilePrefix: string;
  private readonly decoder = new TextDecoder();
  private rawChunks: Buffer[] = [];
  private tailText = "";
  private tailBytes = 0;
  private tailStartsAtLineBoundary = true;
  private totalRawBytes = 0;
  private totalDecodedBytes = 0;
  private completedLines = 0;
  private totalLines = 0;
  private hasOpenLine = false;
  private finished = false;
  private tempFilePath: string | undefined;
  private tempFileStream: WriteStream | undefined;

  constructor(options: { maxLines?: number; maxBytes?: number; tempFilePrefix?: string } = {}) {
    this.maxLines = options.maxLines ?? aiAgentToolMaxLines;
    this.maxBytes = options.maxBytes ?? aiAgentToolMaxBytes;
    this.maxRollingBytes = Math.max(this.maxBytes * 2, 1);
    this.tempFilePrefix = options.tempFilePrefix ?? "freelens-ai-agent";
  }

  append(data: Buffer) {
    if (this.finished) {
      throw new Error("Cannot append to a finished output accumulator");
    }

    this.totalRawBytes += data.length;
    this.appendDecodedText(this.decoder.decode(data, { stream: true }));

    if (this.tempFileStream || this.shouldPersistToFile()) {
      this.ensureTempFile();
      this.tempFileStream?.write(data);
    } else if (data.length > 0) {
      this.rawChunks.push(data);
    }
  }

  finish() {
    if (this.finished) {
      return;
    }

    this.finished = true;
    this.appendDecodedText(this.decoder.decode());

    if (this.shouldPersistToFile()) {
      this.ensureTempFile();
    }
  }

  snapshot(options: { persistIfTruncated?: boolean } = {}): AiAgentToolOutputSnapshot {
    const tailTruncation = truncateToolOutputTail(this.getSnapshotText(), this.maxLines, this.maxBytes);
    // The rolling tail buffer only retains the trailing window of a large stream, so its line/byte
    // counts under-report the real totals. Re-project them from the accumulator's running counters
    // (which are never trimmed) so the "[Showing lines X-Y of Z]" notice reports the true total.
    const truncation: AiAgentToolResultTruncation & { content: string } = {
      ...tailTruncation,
      totalLines: Math.max(tailTruncation.totalLines, this.totalLines),
      totalBytes: Math.max(tailTruncation.totalBytes, this.totalDecodedBytes),
    };

    if (options.persistIfTruncated && truncation.truncated) {
      this.ensureTempFile();
    }

    return {
      content: truncation.content,
      truncation,
      fullOutputPath: this.tempFilePath,
    };
  }

  async closeTempFile() {
    if (!this.tempFileStream) {
      return;
    }

    const stream = this.tempFileStream;

    this.tempFileStream = undefined;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        stream.off("finish", onFinish);
        reject(error);
      };
      const onFinish = () => {
        stream.off("error", onError);
        resolve();
      };

      stream.once("error", onError);
      stream.once("finish", onFinish);
      stream.end();
    });
  }

  private appendDecodedText(text: string) {
    if (text.length === 0) {
      return;
    }

    this.totalDecodedBytes += byteLength(text);
    this.tailText += text;
    this.tailBytes += byteLength(text);

    if (this.tailBytes > this.maxRollingBytes * 2) {
      this.trimTail();
    }

    let newlines = 0;
    let lastNewline = -1;

    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
      newlines += 1;
      lastNewline = index;
    }

    if (newlines === 0) {
      this.hasOpenLine = true;
    } else {
      this.completedLines += newlines;
      this.hasOpenLine = text.slice(lastNewline + 1).length > 0;
    }

    this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0);
  }

  private trimTail() {
    const buffer = Buffer.from(this.tailText, "utf-8");

    if (buffer.length <= this.maxRollingBytes) {
      this.tailBytes = buffer.length;

      return;
    }

    let start = buffer.length - this.maxRollingBytes;

    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
      start += 1;
    }

    this.tailStartsAtLineBoundary = start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a;
    this.tailText = buffer.subarray(start).toString("utf-8");
    this.tailBytes = byteLength(this.tailText);
  }

  private getSnapshotText() {
    if (this.tailStartsAtLineBoundary) {
      return this.tailText;
    }

    const firstNewline = this.tailText.indexOf("\n");

    return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1);
  }

  private shouldPersistToFile() {
    return (
      this.totalRawBytes > this.maxBytes || this.totalDecodedBytes > this.maxBytes || this.totalLines > this.maxLines
    );
  }

  private ensureTempFile() {
    if (this.tempFilePath) {
      return;
    }

    this.tempFilePath = persistToolOutput("", this.tempFilePrefix);
    this.tempFileStream = createWriteStream(this.tempFilePath);

    for (const chunk of this.rawChunks) {
      this.tempFileStream.write(chunk);
    }

    this.rawChunks = [];
  }
}

export const createAiAgentToolExecutionPayload = (
  command: string | undefined,
  rawOutput: string,
): AiAgentToolExecutionPayload => {
  const truncation = truncateToolOutputTail(rawOutput);

  if (!truncation.truncated) {
    return {
      content: rawOutput || "Command completed with no output.",
      details: command ? { command } : undefined,
    };
  }

  const fullOutputPath = persistToolOutput(rawOutput, command ?? "tool");

  return createPayloadFromSnapshot(command, {
    content: truncation.content,
    truncation,
    fullOutputPath,
  });
};

export const createAiAgentToolExecutionPayloadFromSnapshot = (
  command: string | undefined,
  snapshot: AiAgentToolOutputSnapshot,
) => createPayloadFromSnapshot(command, snapshot);
