# How the Relational Builder commons takes things in

*Written 2026-11-09, from reading the code in `relational-builder` and `watcher`. Step 1 of the "Knowy into the RB commons" brief.*

Short version: the manifest format is documented and this repo now follows it. The part that makes Knowy remixable in the Builder is not the manifest. It is a gallery entry in the commons database, and that is done.

## The manifest (`.reltech.yml`)

The spec is `reltech-manifest-spec.md` in the `watcher` repo, version 2:

| Block | Fields |
| --- | --- |
| `version` | `2` |
| `project` | `name`, `description`, `neighborhood`, `builder` |
| `lineage` | `remixed_from`, `remixed_from_url`, `creator`, `note` (omit for original work) |
| `tags` | short, lowercase, hyphenated |
| `watch` | `branches`, `signals`, `threshold` |
| `preferences` | `summarize_commits`, `summarize_readme`, `public_link`, `name_contributors`, `contact` |
| `interests` | same vocabulary as `tags` |

Relational Builder writes this file for every build it exports (`src/project/export.ts`) and adds three things the spec does not document:

- extra lineage keys: `grown_from_prompt`, `grown_from_prompt_id`, `studio`, `studio_name`
- a `prompt:` block with `title` and `body`, so the recipe travels with the code
- a `place:` block, only when a builder lists the project on the public map

**Nothing reads the `prompt:` block back.** The watcher does not parse it and the Builder does not import it. This repo's manifest carries the build prompt because the brief asks for it and because it is the convention the Builder writes, but a prompt in a manifest does not reach the gallery or Plan mode on its own.

## The watcher

Finds public GitHub repos with the `relational-tech` topic twice a day, reads the manifest fields above, and writes the network directory and feed (updates.relationaltechproject.org). Adding the topic is the whole act of joining. **Still to do: add the topic to this repo** (repo settings; not something a PR can do).

## The gallery

The gallery reads `commons_items` in the RTP site's database, one shelf at a time. Item shape: `slug`, `kind` (methodology, framework, recipe, reference, tool, story, prompt), `title`, `summary`, `body` (Markdown), `attribution`, `source_url`, `tags`, `image_urls`, `metadata` (card image in `metadata.image_url`, pin in `metadata.location`), `license`, `sort_order`. Shelves are seeded from JSON files in `relational-builder/scripts/seed/`.

"Build with this" on a card opens a fresh workspace in Plan mode with a drafted first message, the card image attached, and lineage recorded. For a prompt card the draft is the prompt's whole body (changed in relational-builder PR 79; before that only the summary went in).

**Knowy is in the gallery** as of 2026-11-09, on the Local Civic Tech shelf:

- `knowy` (tool): what it is, the rules, the practice, the scales, screenshots, a link to knowy.org
- `build-knowy-for-your-place` (prompt): the template. The same text as the `prompt:` block in this repo's manifest. Change both together.

## The contribution queue

The commons' `submit-contribution` function: `contribution_type` (tool, program, story, reference, prompt), `title`, `summary`, `body`, `builder_name`, `neighborhood`, `contact_email`, `source_url`, `tags`, `images`, `location`, `builder_confirmed`. It lands as pending, a steward approves, and it is credited by name on the Contributed shelf.

Knowy went in through the seed instead, so it does not need the queue. Sending it through both would show it twice. The queue is the right door for remixes: a house or a block that builds its own Knowy can offer it back from the Builder's Publish flow.

## What a Knowy built in the Builder is

A lighter one with the same rules. The place's notes are plain files in the shape `template/` uses. The page answers from them through the Builder's managed `ai_chat` capability (one completion per question, no tools), cites, says "I don't know", and drafts changes for a steward.

It does not have this repo's live tool use, pull requests from a GitHub App, per-source adapters, or the place pack. Because the notes keep the same shape, a place that outgrows the light version can run this code on them.

`ai_chat` serves Anthropic, OpenAI or Gemini keys, or the Builder's community plan. It has no open-weight option today. An open-weight Knowy means this repo's agent, once it has its provider setting.
