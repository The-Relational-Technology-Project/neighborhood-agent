import { icsAdapter } from "./ics.js";
import { llmTxtAdapter } from "./llm-txt.js";
import { neighborhoodApiAdapter } from "./neighborhood-api.js";
import { recsAdapter } from "./recs.js";
import { socrataAdapter } from "./socrata.js";
import { repoAdapter } from "./repo.js";
import { supabaseRestAdapter } from "./supabase-rest.js";
import type { Adapter } from "./types.js";

export const adapters: Record<string, Adapter> = Object.fromEntries(
  [repoAdapter, supabaseRestAdapter, icsAdapter, llmTxtAdapter, neighborhoodApiAdapter, recsAdapter, socrataAdapter].map((a) => [a.id, a]),
);
