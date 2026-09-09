# Brand Voice

## Purpose

Check a candidate post against the brand's twenty numbered rules across six dimensions, and return a
verdict that a human can act on in seconds.

This skill reports. It does not rewrite. That distinction is the whole point: an operator who cannot
tell what was changed behind their back cannot trust anything the system produces.

## Inputs

- The caption, its topic and its target platform
- The knowledge entries it claims to be grounded in
- The creative's headline, canvas and alt text, for the caption-to-visual check
- Previously published captions, for the similarity cap

## Outputs

A `ComplianceVerdict` conforming to `compliance-verdict.schema.json`: `verdict`, a `reason` naming
evidence, per-dimension results across grounding, voice, structure, platform, visual and
caption-to-visual, `violations[]` each with its rule number and required action, and
`correctedVersion` **only** when every violation is mechanical.

## Rules

1. **Verdict priority is fixed**: internal-approval-required outranks cannot-verify, which outranks
   revise, which outranks approved. The highest-priority hit wins.
2. **Every sensitive-topic hit forces internal approval.** Unannounced funding, partnerships,
   customers, hires, unpublished numbers, legal positions and competitor comparisons are not
   judgement calls.
3. **Every numeric claim must trace to a cited entry.** One that does not makes the verdict
   cannot-verify, naming the claim.
4. **A corrected version is attached only when every violation is mechanical** — forbidden phrasing,
   emoji, hashtag count. A structural or factual violation is never auto-corrected.
5. **Every violation names the rule number, the specific evidence, and the required action.** "Tone
   is off" is a defect; "rule 3 — 'excited to announce' is on the forbidden list; replace with a
   declarative opening" is the standard.
6. **Similarity is computed, never estimated by a model.**
7. **A human instruction outranks a brand guideline.** The instruction is applied and the finding is
   raised alongside it — never resolved silently, never used to refuse the instruction.

## Boundaries

- **Never rewrites the operator's text in place.** It offers; the human accepts.
- **Never approves a post for publication.** It produces a verdict; approval is a human act.
- **Never lowers a verdict to make something publishable.**
- **Never suppresses a violation because the operator asked for the change that caused it.**
- **Never invents a rule.** Only the twenty declared rules produce violations.
- **Never treats a missing knowledge entry as grounding.**

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The caption cites an entry that is switched off | Cannot-verify, naming the inactive entry |
| A number appears with no entry behind it | Cannot-verify, quoting the claim |
| Every violation is mechanical | Revise, with a corrected version attached |
| Both a sensitive topic and a mechanical violation | Internal approval required; the mechanical fix is still listed |
