# Neighbors who offered to be asked

One file per neighbor who said "you can ask me". Knowy drafts these when someone confirms the offer from their own email; a steward reads the description and adds it.

Only what is public lives here: how to describe the person (no name needed) and what they know. Their name and email are kept in a private store, never in these notes. `ref` is an opaque handle Knowy uses to reach them; it means nothing on its own.

```yaml
described_as: a neighbor on the corner since 1990
knows: the garden's history, who planted the plum tree
since: 2026-01-10
status: active        # active | paused | left
ref: (filled in by Knowy)
```

To stop Knowy offering someone, set `status: paused` or delete the file.
