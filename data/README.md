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

## Recommended Data Pipeline

```text
LEGISinfo bills JSON
  -> normalized bill inbox JSON
  -> scored/recommended bills JSON
  -> selected bill detail JSON
  -> selected bill text XML
  -> normalized bill clauses JSON
  -> amendment operations JSON
  -> Justice Laws current Act XML
  -> normalized law JSON
  -> proposed law JSON and diff JSON
  -> client impact JSON
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

## Next Data Files To Add

For a selected demo bill, add:

```text
data/bills/45-1/S-202/metadata.json
data/bills/45-1/S-202/bill.xml
data/bills/45-1/S-202/bill.normalized.json
data/bills/45-1/S-202/amendments.json
data/laws/Food-and-Drugs-Act/current.xml
data/laws/Food-and-Drugs-Act/current.normalized.json
data/laws/Food-and-Drugs-Act/versions/S-202-proposed.normalized.json
data/laws/Food-and-Drugs-Act/versions/S-202-diff.json
```
