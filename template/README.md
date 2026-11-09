# Your place's notes

This folder is a starter set of notes for a new Knowy: an AI agent that acts on behalf of a place. Copy it into its own repo, fill it in, and point the agent at it with `DATA_REPO`.

Everything the agent knows about your place lives here, in files a person can read. Stewards change the agent by changing these files. Nobody has to touch the code.

## Fill in, in this order

1. `place.md`: what the place is, its edges, the agent's name and voice.
2. `STEWARDS.md`: who looks after it and how you decide together.
3. `constituents/`: one file per more-than-human neighbor, with the people who speak up for it.
4. `sources.yml`: what the agent may read. Start with only these notes.
5. `people.yml`: people it may point to. Nobody goes in without their yes.
6. `places.yml`, `resources.yml`, `doors.yml`: as you have them. Empty is fine.

Lines in CAPITALS are placeholders. Replace every one, or delete the line. `docs/STEWARDING.md` in the code repo is the stewards' guide.

## What scale is this place?

The same notes work for a house, a block, a co-op, a co-living community or a neighborhood. Smaller places change three things:

- **Fewer public sources.** A neighborhood has calendars, feeds and open data. A house mostly has what its people write down. `sources.yml` may hold only the notes themselves, and that is enough.
- **More consent questions.** In a house, everything the agent knows is about the people who live there. Agree together what goes in before anything does. Leave out anything one person would not want another to ask about.
- **A private repo may be right.** A neighborhood's notes are public so anyone can check them. A household's notes usually should not be. Make the repo private and put the agent's page behind something only the household can reach.

## Folders the agent fills over time

`events/`, `corrections/`, `proposals/` and `suggestions/` start empty. The agent drafts files for them when someone asks, and a steward decides. `archive/` is for background and history. `log/questions.md` counts what people ask, by topic, with nothing about who asked.

## Check it loads

From the code repo:

```bash
DATA_REPO=./template npm run index
```

Anything red is a file that did not parse.
