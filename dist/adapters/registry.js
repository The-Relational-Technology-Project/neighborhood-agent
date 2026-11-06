import { icsAdapter } from "./ics.js";
import { llmTxtAdapter } from "./llm-txt.js";
import { neighborhoodApiAdapter } from "./neighborhood-api.js";
import { repoAdapter } from "./repo.js";
import { supabaseRestAdapter } from "./supabase-rest.js";
export const adapters = Object.fromEntries([repoAdapter, supabaseRestAdapter, icsAdapter, llmTxtAdapter, neighborhoodApiAdapter].map((a) => [a.id, a]));
//# sourceMappingURL=registry.js.map