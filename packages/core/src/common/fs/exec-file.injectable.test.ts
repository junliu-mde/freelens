/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

import { createContainer } from "@ogre-tools/injectable";
import { execFile as childProcessExecFile } from "child_process";
import execFileInjectable from "./exec-file.injectable";
import type { ExecFileException } from "child_process";

import type { ExecFile } from "./exec-file.injectable";

describe("exec-file injectable", () => {
  let execFile: ExecFile;
  let callback: (error: ExecFileException | null, stdout: string, stderr: string) => void;
  let stdinEndMock: jest.Mock;
  let childProcessExecFileMock: jest.MockedFunction<typeof childProcessExecFile>;

  beforeEach(() => {
    const di = createContainer("main");

    di.register(execFileInjectable);

    execFile = di.inject(execFileInjectable);
    stdinEndMock = jest.fn();
    childProcessExecFileMock = childProcessExecFile as jest.MockedFunction<typeof childProcessExecFile>;

    childProcessExecFileMock.mockImplementation(((...args: unknown[]) => {
      callback = args[3] as typeof callback;

      return {
        stdin: {
          end: stdinEndMock,
        },
      } as never;
    }) as unknown as typeof childProcessExecFile);
  });

  afterEach(() => {
    childProcessExecFileMock?.mockReset();
  });

  it("writes input to stdin when provided", async () => {
    const resultPromise = execFile("some-file", ["some-arg"], {
      cwd: "/tmp/some-dir",
      input: "some-input",
    });

    expect(childProcessExecFileMock).toHaveBeenCalledWith(
      "some-file",
      ["some-arg"],
      { cwd: "/tmp/some-dir" },
      expect.any(Function),
    );
    expect(stdinEndMock).toHaveBeenCalledWith("some-input");

    callback(null, "some-stdout", "");

    await expect(resultPromise).resolves.toEqual({
      callWasSuccessful: true,
      response: "some-stdout",
    });
  });

  it("keeps stderr on failed executions", async () => {
    const resultPromise = execFile("some-file", ["some-arg"], { cwd: "/tmp/some-dir" });
    const error = new Error("some-error") as ExecFileException;

    callback(error, "", "some-stderr");

    const actual = await resultPromise;

    expect(actual.callWasSuccessful).toBe(false);

    if (!actual.callWasSuccessful) {
      expect(actual.error).toMatchObject({
        message: "some-error",
        stderr: "some-stderr",
      });
    }

    expect(stdinEndMock).not.toHaveBeenCalled();
  });
});
