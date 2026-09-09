<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Architecture

12 agents across 7 stages, 91 skills and 230 declared settings. Ethara acts through 36 tools (17 safe, 17 mutating, 2 irreversible).

## Stages

### Command (`command`)

The operator speaks; Ethara plans, confirms, dispatches and narrates.

- **Ethara Command** (`assistant`) — The command plane

### Discover (`discover`)

Scrape LinkedIn for movement across the keyword set.

- **Scraping Agent** (`scraping`) — Signal capture from LinkedIn

### Assess (`assess`)

Decide what is genuinely trending, and turn it into ranked opportunities.

- **Validation Agent** (`validation`) — Verdicts on every candidate
- **Analysis Agent** (`analysis`) — Opportunities and the consolidated hashtag set

### Plan (`plan`)

Form ideas and place them on the week.

- **Calendar & Ideas Agent** (`calendar`) — The weekly plan

### Create (`create`)

Write the copy, render the creative, apply human edits.

- **Caption Creator Agent** (`caption`) — Platform copy, grounded in the Knowledge Base
- **Image Creator Agent** (`image`) — The shipping creative
- **Review Agent** (`review`) — Human edits and compliance

### Ship (`ship`)

Validate the format, dispatch to the platform, record the receipt.

- **Publishing Agent** (`publishing`) — The one irreversible act

### Learn (`learn`)

Measure against our own baseline, research the web, write the lesson back.

- **Knowledge Agent** (`knowledge`) — The cited Knowledge Base
- **Analytics Agent** (`analytics`) — Measurement against our own baseline
- **Learning Agent** (`learning`) — Turning outcomes into durable knowledge

## The hand-off graph

```mermaid
flowchart LR
  assistant["Ethara Command"] --> scraping["Scraping Agent"]
  assistant["Ethara Command"] --> validation["Validation Agent"]
  assistant["Ethara Command"] --> analysis["Analysis Agent"]
  assistant["Ethara Command"] --> calendar["Calendar & Ideas Agent"]
  assistant["Ethara Command"] --> caption["Caption Creator Agent"]
  assistant["Ethara Command"] --> image["Image Creator Agent"]
  assistant["Ethara Command"] --> review["Review Agent"]
  assistant["Ethara Command"] --> knowledge["Knowledge Agent"]
  assistant["Ethara Command"] --> publishing["Publishing Agent"]
  assistant["Ethara Command"] --> analytics["Analytics Agent"]
  assistant["Ethara Command"] --> learning["Learning Agent"]
  scraping["Scraping Agent"] --> validation["Validation Agent"]
  validation["Validation Agent"] --> analysis["Analysis Agent"]
  analysis["Analysis Agent"] --> calendar["Calendar & Ideas Agent"]
  calendar["Calendar & Ideas Agent"] --> caption["Caption Creator Agent"]
  caption["Caption Creator Agent"] --> image["Image Creator Agent"]
  image["Image Creator Agent"] --> review["Review Agent"]
  review["Review Agent"] --> knowledge["Knowledge Agent"]
  review["Review Agent"] --> publishing["Publishing Agent"]
  knowledge["Knowledge Agent"] --> caption["Caption Creator Agent"]
  knowledge["Knowledge Agent"] --> image["Image Creator Agent"]
  knowledge["Knowledge Agent"] --> calendar["Calendar & Ideas Agent"]
  knowledge["Knowledge Agent"] --> review["Review Agent"]
  publishing["Publishing Agent"] --> analytics["Analytics Agent"]
  analytics["Analytics Agent"] --> learning["Learning Agent"]
  learning["Learning Agent"] --> knowledge["Knowledge Agent"]
```

> The Orchestration screen draws its edges from `handsOffTo` directly, so this picture **is** the spec. If the order is wrong, fix the graph — never special-case the orchestrator.
