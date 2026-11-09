# neighborhood-agent

An AI agent that acts on behalf of a place, not a person.

A personal AI agent gets better the more it knows about you. This one belongs to a neighborhood instead, and everything it knows is public and shared. Any neighbor can message it on a public web page. It answers from public neighborhood data with sources, says "I don't know" in those words when it doesn't, and points you to a person more often than it hands you a paragraph. When you ask it to change something ("add my event", "that closes at 6 now", "can we start a tool library?") it doesn't just do it. It writes up the change as a pull request on a public repo and the neighborhood's stewards approve it.

This repo is the code. The neighborhood's data lives in a separate repo that the code takes as config, so another place can fork the code and bring its own data. The first one is [outer-sunset](https://github.com/The-Relational-Technology-Project/outer-sunset), for the Outer Sunset in San Francisco.

## The rules it's built around

- **The place is its stewards.** A small group of neighbors governs the agent through the data repo: its voice (`place.md`), its sources (`sources.yml`), its corrections. The code never needs to change for that.
- **Public data only, and nothing kept.** The agent reads sources listed in `sources.yml` and nothing else. No accounts, no memory of conversations. The only things that last are a change a neighbor chose to make public (a PR) and one anonymous row per exchange in the question log.
- **Good friction.** The agent never writes to the neighborhood directly. It drafts; the neighbor sees the exact file and taps yes; a PR opens; a steward merges.
- **Humility is structural.** Every factual claim carries its source and fetch time. Corrections in the repo beat fetched data. Unknown hours are unknown.
- **More-than-human neighbors have standing.** The ocean, the dunes, the plovers, the coyotes: the agent reports their vital signs, brings their interests into answers unprompted when a plan touches them, and names their human advocates. It never speaks as them.

## How it works

```
                 neighbor's browser (conversation lives here only)
                         |
                   Hono web server
     /  /about  /sources  /proposals  /correct  /contact   POST /api/chat (SSE)   POST /api/confirm
                         |
                     the agent  (Claude via the Messages API, tool use)
        search_data · get_vital_signs · lookup_person_or_place · draft_pr
                         |                                   \
                   search index                           draft held in memory
            (MiniSearch over normalized records)          until the neighbor taps yes
                         |                                        |
         adapters, one per source type, per-source TTL cache   GitHub App opens the PR
      repo files · Supabase REST · iCal · llm.txt · Neighborhood API      |
                         |                                   stewards merge on GitHub
                 the data repo (git)  <-------- rebuilt from main every few minutes
```

- **One read path.** `sources.yml` lists every source. Each live source has an adapter (`src/adapters/`) that exports `fetch()` and `normalize()`. Records (event, place, group, resource, person, proposal, correction, note, constituent) go into a full-text index. Raw payloads are cached on disk next to the normalized records so a steward can audit what the agent saw. No vector database; the corpus is small.
- **One write path.** The model calls `draft_pr`, which only returns file content. The app shows it to the neighbor with a "Yes, open the PR" button. Only that tap calls GitHub. The PR carries a label (`event`, `correction`, `proposal`) and a body with the neighbor's ask in their words, what changed, and why.
- **Vital signs** (`src/vitals/`) are read live from public feeds named in `sources.yml` with `vital_sign: true`: NOAA tides, Open-Meteo marine and air, iNaturalist, NPS alerts, and a plover season computed from the constituent file.
- **Prompt assembly.** The system prompt is `place.md` + `STEWARDS.md` + `constituents/` + people and resources + a fixed behavior block (`src/agent/prompt.ts`). Stable parts are cached; the date comes after.
- **Limits.** A per-IP rate limit, a daily dollar budget with a hard stop ("I'm resting, try again tomorrow"), fetched content treated as data with an injection scanner that logs attempts, and a refusal rule for anything about a private individual.

## Run it

You need Node 22 and git.

```bash
git clone https://github.com/The-Relational-Technology-Project/neighborhood-agent
cd neighborhood-agent
npm install
cp .env.example .env     # fill in DATA_REPO, ANTHROPIC_API_KEY, the source keys
npm run index            # fetch every source, build the index, print what loaded
npm run ask -- "what's the pizza today?"
npm run dev              # http://localhost:3000
```

`DATA_REPO` can be a local path (handy while editing the data repo) or a git URL (the server clones it and re-pulls every `REPO_POLL_MINUTES`).

Other commands: `npm run vitals`, `npx tsx src/cli.ts search "words"`, `npx tsx src/cli.ts sources`, `npm run golden` (runs `golden.yml` live), `npx tsx src/cli.ts log-pr` (opens the weekly question-log PR), `npm test`.

## Deploy

**Vercel, the quickest way to try the prototype.** Import the repo at vercel.com/new (or `npx vercel`), add the environment variables from `.env.example` (at least `DATA_REPO`, `ANTHROPIC_API_KEY`, and the two anon keys), deploy. Vercel detects the Hono preset and uses the root `index.js`, which exports the app from the compiled `dist/`. `dist/` is committed for that reason: run `npm run build` and commit it along with any change to `src/` (the `prepare` script does this on `npm install`, and `npm test` fails if it is stale). On Vercel the data repo is fetched through the GitHub API instead of git, the source cache lives in the function's `/tmp`, the index is rebuilt on the first request after a cold start and refreshed in the background every `REPO_POLL_MINUTES`, and "Yes, open the PR" carries a signed copy of the draft so it works across instances (set `DRAFT_SECRET` to any long random string, or it is derived from the API key). Also set `GITHUB_TOKEN` to a read-only token: the data repo is read through the GitHub API, and anonymous calls share a 60-an-hour limit per IP with every other tenant on that IP. Two things don't persist across instances there: the daily budget counter and the question log counts, so each warm instance keeps its own. Fine for a trial, not for a long-running deployment.

**Fly or a VPS, for running it for real.** One step on Fly: `fly launch --copy-config --yes`, then `fly secrets set` for each secret in `.env.example`, then `fly volumes create agent_cache --size 1`. The Dockerfile works anywhere that runs a container (a small VPS, Railway, Render). The budget, question log, and cache sit on the volume.

### The GitHub App

Create a GitHub App on the org (Settings → Developer settings → GitHub Apps). Permissions: Contents read and write, Pull requests read and write, Issues read and write. No webhook required (optional: subscribe to `push` and point it at `/api/webhook/github` with `GITHUB_WEBHOOK_SECRET` so merges rebuild the index at once). Install it on the data repo only. Put the App ID and the private key (PEM, newlines as `\n`) in the environment. PRs and contact-form issues come from the app's bot identity.

Without the app configured, the agent still answers; the "Yes, open the PR" button falls back to a prefilled "create file" link on GitHub, and the contact page shows the stewards' email.

## The place pack: the neighborhood's data for other tools

Two open doors, so apps built for the place (in Relational Builder or anywhere) can build on the same commons:

- `GET /place.json`: the place (label, center, catchment, time zone), every source with its license and freshness, the constituents and their advocates, the rules that travel with the data, and how a tool can give back.
- `POST /mcp`: an open MCP server (JSON-RPC over HTTP, no auth, CORS open). Tools: `about_place`, `search`, `list`, `get`, `vital_signs`, `city_311`, `suggest_source`. Replies carry prose and `structuredContent` records.

Nothing is in the pack that a neighbor couldn't already read on the site. `suggest_source` is the way back in: a tool offers its public feed, and it reaches the stewards like any other suggestion (5 an hour per caller). Reads are limited to 300 per 10 minutes per caller. The place lines (`center`, `catchment_miles`, `catchment_label`, `place_label`, `place_about`) live at the end of the data repo's `place.md`. Code: `src/place/pack.ts`.

## For stewards

You don't need to touch this repo. Everything you govern is in the data repo:

- Change the voice or what the agent cares about: edit `place.md`.
- Add or remove a source: edit `sources.yml`. A source with `status: live` and an `adapter` is read on the next rebuild. Secrets go in the server's environment under the name you put in `key_env`.
- Let the agent point to a person: add them to `people.yml` with their yes.
- Fix something: merge a PR into `corrections/`, or write the file yourself.
- Review a PR from the agent: `STEWARDS.md` in the data repo has the checklist.
- Read the question log: `log/questions.md`. It's the quiet prize.

## Forking for another neighborhood

Not a developer? [docs/REMIX.md](docs/REMIX.md) is the half-page version: start a Knowy for your place in Relational Builder, no code. [docs/STEWARDING.md](docs/STEWARDING.md) is the stewards' guide, and `template/` is a blank set of notes for a house, a block, a co-op or a neighborhood.

The fork test in this repo (`fixtures/elsewhere/`, used by `npm test`) is a complete data repo for a fictional neighborhood. It runs against the same code with only `DATA_REPO` changed.

1. Create a new data repo. Copy the structure of [outer-sunset](https://github.com/The-Relational-Technology-Project/outer-sunset) or of `fixtures/elsewhere/`: `place.md`, `STEWARDS.md`, `sources.yml`, `people.yml`, `places.yml`, `resources.yml`, `constituents/`, `events/`, `proposals/`, `corrections/`, `archive/`, `log/questions.md`.
2. Write `place.md` in your own words. Name your constituents. List your sources; for each one, pick an adapter that fits (`supabase-rest`, `ics`, `llm-txt`, `neighborhood-api`) or add a new one in `src/adapters/` (one file, `fetch` and `normalize`, registered in `registry.ts`).
3. Set `DATA_REPO` to your repo and run `npm run index`. Fix what's red.
4. Install a GitHub App on your data repo and deploy.
5. Pick a working name for the agent in `place.md`; the page header uses it.

Adapters that need a key read it from the environment variable named in the source's `key_env`. Vital signs take `latitude`/`longitude`/`station` from the source config, so a coastal neighborhood can reuse the NOAA and marine readers by changing numbers.

## Tests

`npm test` runs offline against the fixture: repo parsing, every adapter's `normalize`, the iCal expander, corrections overriding source data, prompt assembly, the four tools, drafts, the budget and rate limiter, the question log, the plover season math, GitHub App JWT signing and webhook verification, the markdown renderer. `npm run golden` runs the spec's golden questions against the real model and data and prints each answer with its tool calls.

## Where things are

```
src/
  config.ts            env → config
  state.ts             repo + index + services, rebuilt on a timer or webhook
  app.ts               Hono routes
  server.ts            Node entry (long-running server with a rebuild timer)
index.js               Vercel entry (exports the app from the committed dist/)
dist/                  compiled output, committed for Vercel
  cli.ts               nagent
  data/                repo loader, record types, cache, search index, source loader
  adapters/            repo, supabase-rest, ics, llm-txt, neighborhood-api, registry
  vitals/              feed readers for tide, water, air, plovers, park alerts, wildlife
  agent/               prompt, tools, drafts, agent loop, budget, question log, classifier
  github/              GitHub App JWT, PRs, issues, webhook verification
  web/                 layout, pages, the chat script
  safety/              injection scanner
fixtures/elsewhere/    a fictional neighborhood's data repo (the fork test)
template/              a blank data repo to copy for a new place
docs/                  REMIX.md, STEWARDING.md, commons-notes.md
.reltech.yml           manifest for the relational tech network, with the build prompt
golden.yml             the acceptance questions
```

MIT. Built with neighbors in the Outer Sunset by the [Relational Tech Project](https://relationaltechproject.org).
