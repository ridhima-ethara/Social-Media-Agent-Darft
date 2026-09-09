## `check_approvals(idea)`

Reports whether Marketing and Leadership have both approved, with who and when.

**Call this first, every time.** It is the gate, and it lives in a tool rather than a prompt
instruction precisely so it cannot be forgotten or reasoned around.

## `validate_format(caption, platform)`

Checks length, hashtag count and media requirements against the platform's limits. Returns every
issue at once, not the first — one round trip should surface all of them.

**Call this before any dispatch.** A format failure must abort before anything leaves the system.

## `dispatch(idea, caption, platform, mode)`

Sends the post and returns a receipt carrying the external id, the mode, and what was actually sent.

In `demo` mode this fabricates an id and says so. In `live` mode with no credential it refuses and
names the missing environment key — it will not fall back to demo, because reporting a post that
never went out is the worst failure this system could have.

**Never call this before `check_approvals` and `validate_format` have both passed.**
