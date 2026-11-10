# Stewarding a Knowy

A Knowy is an AI agent that belongs to a place. The code is the small half. What makes it worth trusting is a few people who look after it. This is their guide. It needs no technical background.

The same practice works for a house, a block, a co-op, a co-living community or a neighborhood. Where it differs for small places, it says so.

## What stewards are for

The agent only knows what is in the place's notes and the sources those notes list. Stewards decide what goes in. The agent drafts; a person says yes; a steward decides. It never changes its own memory.

So stewards hold four things:

- **its voice**: how it sounds and what the place cares about (`place.md`)
- **what it reads**: every source, listed where anyone can see (`sources.yml`)
- **who it points to**: people and groups, each with their yes (`people.yml`)
- **what it got wrong**: corrections, which beat anything it fetched (`corrections/`)

## How stewards decide together

Start with two or three people from different corners of the place. Write your own rules in `STEWARDS.md`. The starting set:

- Everything changes by a reviewed proposal. Nothing goes in on its own.
- One steward can accept an event, a correction, or an idea that looks right and harms no one.
- Changes to the voice, the stewards, the sources, or the more-than-human neighbors wait for two stewards, or seven days with no objection.
- Removing a source, a person, or a constituent comes with a line saying why.

In a house, "stewards" may be everyone, and the place to decide is the house meeting. Write that down instead.

## The review checklist

When the agent sends a draft, it comes with what the person asked for in their words, what the agent changed, and why. Check:

1. **Does it match the ask?** The person saw the exact text before it was sent. Read it anyway.
2. **Is a private person in it?** A host is named only if they gave their name for that purpose. A correction says how the person knows, not who told them.
3. **For a correction, is "how I know" good enough?** A photo of the door, a call, being there. "I heard" is not enough. Ask.
4. **For an idea, does it already exist?** If so, point there and close it.

Then accept it or leave a comment. The agent does not follow up on its own. The person has to come back.

## Consent for listing people

Nobody is in the notes without their yes, for this purpose.

- Ask the person directly. Say what the agent will send their way and what contact it will show.
- Write down the date and how they said yes (`listed`, `consent`).
- Until then, list the group and its public contact, not the person.
- Anyone can ask to be removed at any time. Do it the same day.
- Groups too: point to a group only if it is public, or its organizers said the agent may.

**At small scale this is most of the work.** In a house, everything the agent knows is about the people who live there. Agree together, before anything goes in, what the agent may know: the chore rota and the wifi, probably yes; who is home when, probably no. If one person would not want another to ask the agent about it, leave it out. Guests and children get the same care: nothing about them without a yes from them or their parent.

## Neighbors who offer to be asked

The agent knows the start of most stories. The rest lives with people. So anyone can say "you can ask me" on the commons page: what they know, how to describe them, and a name and email.

- The name and email are private. They are kept outside the notes, the agent never sees them, and stewards do not need them. What reaches you for review is only the public part: a description ("a neighbor on the corner since 1990") and what they know.
- Nobody can be signed up by someone else. Nothing is saved until the person opens a link sent to their own email.
- Read the description like anything else going public. Does it say more than the person would want on a pole? Does it name anyone else? Then accept it.
- When a question fits, the agent emails it to them. The asker can leave an email so the neighbor can write back, or leave nothing, and the answer comes to the notes for everyone.
- They never owe an answer. Every email has a link to stop; it deletes their contact at once, and you get a note to take their file down. To pause someone yourself, set `status: paused` in their file.

## What neighbors give

Things people know arrive as drafts for `knowledge/`: a memory, a piece of history, an answer to someone's question. Treat each one as a gift.

- Keep their words. Fix a typo, not the voice.
- Credit them the way they asked. "A neighbor" is the default.
- Leave out other people's names and addresses, and ask before accepting anything that reads as a complaint about someone.
- You don't have to check it like a newspaper would. The agent passes it on as one neighbor's account, and says so. If it contradicts a published source, both get told.
- If two neighbors remember it differently, keep both.

Everything in the notes is shared under an open license, so anyone can reuse it with credit. Say so when someone asks what happens to what they give.

## Good friction

Changes are slow on purpose.

- The agent shows the person the exact change before it is sent.
- It never says "done" or "added". It says a steward will look.
- A steward reads every change.

If someone asks for the agent to just update things itself, the answer is no, and it is worth saying why: a shared memory that anyone can edit through a chat box stops being one people trust.

## Correcting it

When it says something wrong, fix the notes, not the agent. Add a correction with what it was, what is right, and how you know. Corrections win over fetched data from then on. If a source keeps being wrong, take it out of `sources.yml` and say why.

## More-than-human neighbors

Each one has a file: the creek, the garden, the birds, the street trees. The file names the people who speak up for it. The agent brings them into answers when a plan touches them (a bonfire on the beach, pruning in nesting season) and names those advocates. It reports what is known. It never speaks as them.

## The question log

The agent keeps one thing: a weekly count of what people asked about, by topic, with nothing about who asked. Read it together now and then. A topic it keeps not knowing is a gap in the notes, or something the place wants and does not have.

## What a Knowy never does

- Changes its own notes, or says a change is made before a steward accepts it.
- Remembers a conversation, or asks people to sign in to ask.
- Shows or learns the name or email of a neighbor who offered to be asked.
- Signs anyone up to be asked, or presses anyone to share.
- Says where anyone lives, who said what in a chat, or anything about a private person.
- Guesses hours, prices, or whether something is open.
- Speaks as the ocean, the plovers, or any more-than-human neighbor.
- Reads a source that is not on its list.
- Commits the place to anything.

## Stepping back, and ending it

A steward can step back at any time with no explanation. If nobody is left to steward it, turn the agent off. The notes stay, and the next group can pick them up.
