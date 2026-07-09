<!-- agdocs:begin -->

## CONTEXT.md

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

Use its canonical terms, and avoid the listed aliases, wherever a domain concept appears in docs, tests, or implementation. Update it whenever a term is added, renamed, or clarified.

**File structure.** Single context: a root `CONTEXT.md` and `docs/adr/`.

**Format.**

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction
```

**Rules.**

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as aliases to avoid.
- **Flag conflicts explicitly.** If a term is used ambiguously, call it out in "Flagged ambiguities" with a clear resolution.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Show relationships.** Use bold term names and express cardinality where obvious.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.
- **Write an example dialogue.** A conversation between a dev and a domain expert that demonstrates how the terms interact naturally and clarifies boundaries between related concepts.

## docs/adr/

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc. Create the directory lazily — only when the first ADR is needed. Scan `docs/adr/` for the highest existing number and increment by one. Read the ADRs touching an area before changing it, and add or update one when a qualifying decision changes.

**When to write one.**

An ADR records a decision that is costly to reverse. Skip everyday implementation choices. Write one when the choice is:

1. **Consequential** — it constrains future work, shapes the architecture, or would be expensive to undo
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"

If both apply, write the ADR. If only one applies, use judgment. If neither applies, skip it.

**Optional.**

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions are revisited
- **Alternatives considered** — useful when the rejected options are non-obvious

## PRD (`docs/prd/<feature-slug>.md`)

One PRD file per feature. Synthesize the PRD from the current conversation and codebase understanding — do NOT interview the user. Use the project's domain glossary vocabulary throughout, and respect any ADRs in the area you're touching. This repo keeps PRDs only: do not create issue or task files, and do not run a triage step, unless the user explicitly asks. Update the PRD when product scope, user flows, implementation decisions, or testing decisions change.

```md
# <feature-slug>

**<Feature Name>**

## Problem Statement

The problem that the user is facing.

## Solution

The solution that the user is proposing.

## User Stories

How the user will interact with the feature.

## Implementation Decisions

Key decisions that the user has made about the feature.

## Testing Decisions

Key decisions that the user has made about testing the feature.

## Out of Scope

The things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.
```

## DESIGN.md

The current workspace's visual and interaction direction. Read it before changing UI, and update it when those conventions stably change.

<!-- agdocs:end -->
