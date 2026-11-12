# Blocks

Notes pinned to a spot: what happened at this corner, what is under this street, an old photograph taken here. Knowy answers "what's special about my block?" from these.

Two kinds of file, both YAML:

- `grid.yml` lists the place's blocks under `blocks:`. Each has an `id`, a `name` ("Main St, 1st Ave to 2nd Ave"), its `streets` (the street and its two cross streets, used to match what a neighbor types), `lat`, `lng`, and optionally `about`, a line that is true of that block alone.
- Any other file lists pinned notes under `notes:`. Each has a `title`, `text`, `lat`, `lng`, and its `sources` (name and url). Optional: `kind` (history, geology, ecology, photo), `at` (the corner in words), `years`, `tags`, `reach` (`spot` by default; `area` with a `radius_m` for a wider stretch; `everywhere` for something true of every block), and for a photograph `photo: {page, credit}`.

Rules that keep it kind:

- Blocks and corners, never house numbers. Nothing here says where a person lives.
- Every note names where it came from. A photograph links to its own archive and is credited the way the archive asks.
- A neighbor's correction or own account wins.

A house or a co-op doesn't need this folder. Leave it out and Knowy won't offer it.
