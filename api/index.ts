/** Vercel entry point. Every route is rewritten here (see vercel.json). */
import { handle } from "hono/vercel";
import { createApp } from "../src/app.js";
import { AppState } from "../src/state.js";

const state = new AppState();
const app = createApp(state);

export default handle(app);
