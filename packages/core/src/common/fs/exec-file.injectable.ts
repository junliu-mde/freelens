/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { execFile } from "child_process";
import type { ExecFileException, ExecFileOptions } from "child_process";

import type { AsyncResult } from "@freelensapp/utilities";

export type ExecFileError = ExecFileException & { stderr: string };
export type ExecFileOptionsWithInput = ExecFileOptions & { input?: string | NodeJS.ArrayBufferView };

export interface ExecFile {
  (filePath: string): AsyncResult<string, ExecFileError>;
  (filePath: string, argsOrOptions: string[] | ExecFileOptionsWithInput): AsyncResult<string, ExecFileError>;
  (filePath: string, args: string[], options: ExecFileOptionsWithInput): AsyncResult<string, ExecFileError>;
}

const execFileInjectable = getInjectable({
  id: "exec-file",

  instantiate: (): ExecFile => {
    return (
      filePath: string,
      argsOrOptions?: string[] | ExecFileOptionsWithInput,
      maybeOptions?: ExecFileOptionsWithInput,
    ) => {
      const { args, options } = (() => {
        if (Array.isArray(argsOrOptions)) {
          return {
            args: argsOrOptions,
            options: maybeOptions ?? {},
          };
        } else {
          return {
            args: [],
            options: argsOrOptions ?? {},
          };
        }
      })();
      const { input, ...execOptions } = options;

      return new Promise((resolve) => {
        try {
          const execution = execFile(filePath, args, execOptions, (error, stdout, stderr) => {
            if (error) {
              resolve({
                callWasSuccessful: false,
                error: Object.assign(error, { stderr }),
              });
            } else {
              resolve({
                callWasSuccessful: true,
                response: stdout.toString(),
              });
            }
          });

          if (input !== undefined) {
            execution.stdin?.end(input);
          }
        } catch (error) {
          // On Windows, spawn failures such as `spawn UNKNOWN` (errno -4094)
          // are thrown synchronously instead of being passed to the callback.
          // Convert them into the AsyncResult error shape so callers don't hang.
          resolve({
            callWasSuccessful: false,
            error: Object.assign(error as ExecFileError, {
              stderr: (error as Partial<ExecFileError>).stderr ?? "",
            }),
          });
        }
      });
    };
  },

  causesSideEffects: true,
});

export default execFileInjectable;
