# Data README

This folder is intentionally minimal. It holds source data and normalized JSON outputs that the app can consume.

## Files

```text
raw/legisinfo/45-1/bills.json
```

Raw federal bill metadata from LEGISinfo.

Source:

```text
https://www.parl.ca/legisinfo/en/bills/json?parlsession=45-1
```

```text
normalized/bills.45-1.json
```

Cleaned bill inbox. Use this for the UI bill list.

```text
normalized/recommended-bills.45-1.json
```

Bills scored as good candidates for deeper analysis.

```text
clients/demo/
```

Fake client profiles for demonstrations.

```text
bills/45-1/{bill-number}/
```

Actual bill content from Parliament.

Each retrieved bill folder contains:

```text
metadata.json          LEGISinfo detail JSON
bill.xml               official Parliament bill text XML
bill.normalized.json   normalized title, sponsor, full text, and clauses
source.json            URLs, stage, and retrieval timestamp
```

```text
bills/45-1/manifest.json
```

Retrieval manifest for the recommended bill text set.

```text
laws/registry.json
```

Known laws and their official Justice Laws source URLs.

```text
laws/bill-law-links.45-1.json
```

The first explicit links from retrieved bills to current laws.

```text
laws/current/federal/food-and-drugs-act/
```

Current consolidated law baseline from Justice Laws.

```text
current.xml             official Justice Laws XML
current.normalized.json normalized full text and sections
source.json             registry data, source URLs, and retrieval timestamp
```

## Recommended Data Pipeline

```text
LEGISinfo bills JSON
  -> normalized bill inbox JSON
  -> scored/recommended bills JSON
  -> selected bill detail JSON
  -> selected bill text XML
  -> normalized bill clauses JSON
  -> identify target Act from title/targetActs
  -> data/laws/registry.json
  -> Justice Laws current Act XML
  -> normalized law JSON
  -> amendment operations JSON
  -> proposed law JSON and diff JSON
  -> client impact JSON
```

## Bill To Law Retrieval

Bills and laws come from different government systems:

```text
Parliament / LEGISinfo
  -> bill metadata JSON
  -> bill text XML

Justice Laws
  -> current consolidated Act XML
```

The connection between them is the Act name. For example:

```text
S-202 bill text says it amends the Food and Drugs Act
  -> data/laws/registry.json maps food-and-drugs-act to Justice Laws XML
  -> scripts/retrieve-law.mjs downloads the current Food and Drugs Act
```

## Bill Categories

Use these categories to keep the pipeline adaptable:

```text
amends_existing_act
creates_new_act
framework_bill
appropriation_bill
symbolic_bill
defeated_or_inactive
tech_relevant
health_relevant
commercial_relevant
clean_patch_candidate
high_demo_value
```

## Scoring Rules

Suggested scoring:

```text
+5 tech/data/cyber/deepfake/lawful access/interoperability
+4 health or Food and Drugs Act relevance
+4 amends existing Act
+3 clean patch candidate
+3 late stage or royal assent
+2 committee stage
-1 framework bill
-6 appropriation bill
-6 symbolic bill
-10 defeated, inactive, or pro forma bill
```

Recommended buckets:

```text
12+  analyze_now
8-11 monitor_closely
4-7  low_priority_watch
<4   ignore_for_demo
```

## Retrieval Rules

Use JSON for the bill inbox and app logic.

Use XML only for legal source text:

```text
Parliament bill text XML
Justice Laws current Act XML
```

Immediately convert legal XML into normalized JSON before AI analysis or UI rendering.

## Refresh Commands

Retrieve the recommended bill text set:

```text
node --use-system-ca scripts/retrieve-bill-texts.mjs
```

Retrieve every bill with an available text ID:

```text
node --use-system-ca scripts/retrieve-bill-texts.mjs --all
```

Retrieve a small smoke-test sample:

```text
node --use-system-ca scripts/retrieve-bill-texts.mjs --limit 3
```

Refresh the current Food and Drugs Act:

```text
node --use-system-ca scripts/retrieve-law.mjs food-and-drugs-act
```

## Next Data Files To Add

For comparison output, add generated files beside the current law baseline:

```text
data/laws/current/federal/food-and-drugs-act/versions/S-202-proposed.normalized.json
data/laws/current/federal/food-and-drugs-act/versions/S-202-diff.json
data/bills/45-1/S-202/amendments.json
```
