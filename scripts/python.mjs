#!/usr/bin/env node
/**
 * Run a Python script with the interpreter name this platform understands.
 *
 *   node scripts/python.mjs design/build-all.py [args...]
 *
 * Exists for `npm run brand:build`: a package.json script is one command line
 * for every platform, and no single spelling of the interpreter works on all
 * three. The choice itself lives in `PYTHON`, next to the other process
 * plumbing.
 */

import { PYTHON, run } from "./lib/shell.mjs";

const res = run(PYTHON, process.argv.slice(2), { stdio: "inherit" });
process.exit(res.status);
