/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Attaching an "error" listener to process.stdout/stderr suppresses Node's default behavior of
// throwing on an unhandled stream error. We only want to swallow EPIPE (which happens benignly when
// a parent process closes the pipe); every other error must still surface rather than be lost.
//
// This lives in its own module so the main entrypoint can import it first: ES module import
// side-effects run in source order, so importing this before the heavy feature graph guarantees the
// handlers are attached before any imported module writes to stdout/stderr during initialization
// (a parent closing the pipe in that early window would otherwise crash with an unhandled EPIPE).
const ignoreEpipeErrors = (stream: NodeJS.WriteStream) => {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") {
      return;
    }

    // Re-surface any non-EPIPE write error instead of silently swallowing it.
    throw err;
  });
};

ignoreEpipeErrors(process.stdout);
ignoreEpipeErrors(process.stderr);
