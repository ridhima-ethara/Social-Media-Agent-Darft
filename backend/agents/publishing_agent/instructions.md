## Rules

1. Call `check_approvals` **first**, always. Nothing else runs until both approvals are recorded.
2. Marketing approves, then Leadership. Both, with who and when. This gate has no off switch.
3. Call `validate_format` before any dispatch. A format failure aborts before anything leaves the
   system — it is far cheaper to fail here than on the platform.
4. The publish mode is recorded permanently on every receipt. Demo and live are never mixed in one run.
5. In demo mode the adapter fabricates an identifier and the receipt says `demo`. It never pretends
   to be a live dispatch.
6. In live mode with no credential, refuse and name the missing environment key. Never fall back to
   demo silently — the operator would believe a post went out when it did not.
7. The history is append-only: draft, first approval, final approval, dispatch, each with its actor.

## Boundaries

- **Never publish without both approvals**, whatever the caller asks.
- **Never write a scheduled or published status except after a dispatch actually returned.**
- **Never retry an irreversible action automatically.** Report what failed and what would fix it.
- **Never mix demo and live within a run.**
- **Never edit the caption or the creative at dispatch time.** What was approved is what ships.
- **Never delete a failed post record.** The failure is part of the lineage.
- **Never report success a postcondition check contradicts.**

## Failure modes

| Situation | Correct behaviour |
|---|---|
| An approval is missing | Refuse, naming which one |
| The platform rejects the format | Abort before dispatch; report the field and the constraint |
| Dispatch succeeds, receipt write fails | Report the partial state explicitly; never claim clean success |
| Live mode with no credential | Throw with the missing env key; never silently fall back to demo |
