/** Node entry point: a long-running server with a rebuild timer. */
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { AppState } from "./state.js";
const state = new AppState();
const app = createApp(state);
const port = state.cfg.port;
state.ready().then(() => {
    state.startPolling();
    serve({ fetch: app.fetch, port }, () => {
        console.log(`neighborhood agent on http://localhost:${port}  records=${state.index.size}  model=${state.agent ? state.cfg.model : "not configured"}  github=${state.github.configured ? state.github.repo : "not configured"}`);
    });
}).catch((err) => {
    console.error("failed to start:", err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map