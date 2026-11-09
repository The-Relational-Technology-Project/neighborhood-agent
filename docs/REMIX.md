# Make a Knowy for your place

**What Knowy is.** Knowy is an AI agent that belongs to a place, not a person. People who live there ask it things. It answers from the place's own shared notes, says where each fact came from, and says "I don't know" when the notes don't cover it. It points you to a person more often than it writes you a paragraph. When someone asks it to add or change something, it writes the change up and a steward decides. The first one is [Knowy Plover](https://knowy.org), for the Outer Sunset in San Francisco. The same shape works for a house, a block, a co-op, a co-living community or a neighborhood.

**How to start your own.** You don't need to code.

1. Open [Relational Builder](https://relationalbuilder.org) and go to the gallery.
2. Find **Build: A Knowy for Your Place** and choose "Build with this".
3. It asks you six things before it builds anything: what your place is and where it stops, who the first stewards are, what it may read, who your more-than-human neighbors are (a creek, a garden, the birds) and who speaks up for them, what to call it and how it should sound, and who can see it.
4. It writes your place's notes as plain files you can read and edit, and builds a page people can ask.

Not ready with real answers? Ask it to start with a made-up place so you can see it work first. For a household, keep it private, and agree together what it may know before anything goes in.

What you get in the Builder is a lighter Knowy with the same rules. The full agent in this repo adds live sources (calendars, city data, other sites) and sends its drafts to stewards as pull requests. Your notes use the same shape, so you can move to the full agent later without starting over. `template/` is a blank set of notes for that.

**What stewards do.** Two or three people look after it. They decide how it sounds, what it reads, and who it may point to. They read every change before it goes in. Nobody is listed without their yes. They fix it when it is wrong, and now and then they read the list of what people asked. [STEWARDING.md](./STEWARDING.md) is the whole practice, in plain language.

**What it costs.** Not much, and it is capped. The agent has a daily spending limit (5 dollars by default, and you can set it lower). When it reaches the limit it says it is resting until tomorrow. A small place asks few questions and will sit far under that.

Running it on an open model (one whose weights are public, hosted by a provider or on a computer in the room) is being added to this repo now. A model on your own machine costs nothing per question beyond the machine and its power. Measured costs and how well open models answer the test questions will be in `docs/golden-results.md` when that work lands. Until then the full agent runs on Claude, and a Knowy built in the Builder uses the Builder's own AI.
