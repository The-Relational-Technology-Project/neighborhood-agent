# Outer Sunset

This repo is the memory and the constitution of the Outer Sunset's neighborhood agent.

The agent is an AI that acts on behalf of a place, not a person. Any neighbor can message it. It answers from public neighborhood data with sources, points people to other people, and turns asks ("add my event", "that closes at 6 now", "can we start a tool library?") into pull requests against this repo. Stewards merge. Nothing the agent knows lives outside this repo or a public source this repo points to.

The code that runs the agent lives in a separate repo, [neighborhood-agent](https://github.com/The-Relational-Technology-Project/neighborhood-agent), so another place can fork the code and bring its own data.

## What's in here

| Path | What it is | Who edits it |
| --- | --- | --- |
| `place.md` | The agent's standing instructions for this place: name, boundaries, voice, what it cares about | Stewards |
| `STEWARDS.md` | Who governs this, how decisions get made, how PRs get reviewed | Stewards |
| `constituents/` | One file per more-than-human neighbor (ocean, dunes, plovers, coyotes): what it is, which feeds speak for it, which humans advocate for it | Stewards, advocates |
| `sources.yml` | Every data source the agent reads: url, type, refresh cadence, license note. If it isn't listed here, the agent doesn't read it | Stewards |
| `people.yml` | Public points of contact who have agreed to be listed (org, role, how to reach) | Stewards, with each person's yes |
| `places.yml` | Businesses and spots: name, address, hours if known, where the hours came from, last verified | Anyone, by PR |
| `recs/` | Neighbors' recommendations, one file per source (the Outer Dadas recs are the first): vouch counts and dates, no recommender names, no personal numbers without a yes | Stewards, by PR |
| `resources.yml` | Systems neighbors already built and can use: the sharing library, the flyer board, the welcome packet | Anyone, by PR |
| `events/` | One file per committed event, `YYYY-MM-DD-slug.md` with frontmatter | Neighbors via the agent, or by hand |
| `proposals/` | Open asks from neighbors: a build day, a tool library, a question for stewards | Neighbors via the agent, or by hand |
| `corrections/` | Merged corrections, dated and attributed. The agent prefers these over anything it fetched | Neighbors via the agent, or by hand |
| `suggestions/` | Sources neighbors suggested, and what the stewards decided. Knowy shows these but never answers from them | Neighbors via Knowy; stewards set the status |
| `archive/` | History and field notes, one `##` section per subject with its sources: the eras of the place, its plants and animals and how they live together | Anyone, by PR |
| `knowledge/` | What neighbors shared in their own words: memories, history, answers to each other's questions. Passed on as one neighbor's account | Neighbors via Knowy; stewards review |
| `knowers/` | Neighbors who offered to be asked: a description and what they know. No names or emails; those are held privately, outside this repo | Neighbors via Knowy; stewards review |
| `log/questions.md` | Aggregated question log by topic and week. No names, no message text | The agent, by PR |

## How to correct the agent

Three ways, all public:

1. **Tell it.** Say "that's wrong" in the chat. It will show what it currently believes and where that came from, ask what's right and how you know, and open a pull request to `corrections/` after you say yes.
2. **Open a PR yourself.** Copy `corrections/_template.md`, fill it in, open a PR.
3. **Open an issue.** Use the "Correction" issue template if you'd rather not touch files.

A steward reviews and merges. The agent reads `main` within a few minutes of a merge.

## How to add an event

Tell the agent, or copy `events/_template.md` to `events/YYYY-MM-DD-your-slug.md` and open a PR. Only events a neighbor chose to make public belong here. Live calendars (outersunset.today, sunsetboard.org) are read directly and don't need copying in.

## How to become a steward

Read `STEWARDS.md`, then open a PR adding yourself to the stewards table with a line on why. Current stewards decide together.

## What the agent keeps

Nothing from conversations. The only things that last are a change a neighbor chose to make public (as a PR) and one row per exchange in `log/questions.md`: the topic, the week, and whether the answer pointed to a person. No names, no handles, no message text.

## License

Data in this repo is published under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) unless a file says otherwise. Sources listed in `sources.yml` keep their own licenses.

Stewarded with the [Relational Tech Project](https://relationaltechproject.org), Outer Sunset, San Francisco.
