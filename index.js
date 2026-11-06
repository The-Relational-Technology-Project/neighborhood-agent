/**
 * Vercel entry point (Hono framework preset): export the app as default.
 * Plain JavaScript over the committed dist/ on purpose, so Vercel's bundler has no TypeScript to
 * check with its own settings. Run `npm run build` and commit dist/ with any change to src/.
 */
import { Hono } from "hono";
import { createApp } from "./dist/app.js";
import { AppState } from "./dist/state.js";

const state = new AppState();
/** @type {Hono} */
const app = createApp(state);
export default app;
