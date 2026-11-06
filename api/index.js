/**
 * Vercel entry point. Plain JavaScript on purpose: Vercel's function bundler type-checks a
 * TypeScript entry with its own module resolution, which trips over the SDK's types. `dist/` is
 * compiled locally with `npm run build` and committed; run that before pushing.
 */
import { handle } from "hono/vercel";
import { createApp } from "../dist/app.js";
import { AppState } from "../dist/state.js";

const state = new AppState();
const app = createApp(state);

export default handle(app);
