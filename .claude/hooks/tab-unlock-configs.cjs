#!/usr/bin/env node
"use strict";

/**
 * User-side unlock TOGGLE for the configs surface.
 *
 * Each run flips the window: it opens one when closed and closes one when open,
 * so a single command can be bound to a single key. Run it in YOUR OWN terminal —
 * an agent-side unlock is the same as no lock, and `surface-protect` refuses it.
 */

require("./lib/unlock.cjs").toggleWindow("configs", __dirname);
