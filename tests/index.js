// Compatibility shim: on newer Node versions the test runner treats
// positional arguments as globs, so `node --test tests/` executes this
// directory as an entry module instead of walking it. Resolving the
// directory lands here, and requiring the ESM test file (synchronous
// require(esm), Node 22.12+) registers every test in this process.
//
// Default discovery (`node --test` with no args) only matches *.test.*
// files, so this shim never causes a double run.
"use strict";
require("./hud-core.test.mjs");
