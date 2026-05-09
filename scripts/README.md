# Scripts

## Canonical Bill Text Retrieval

Use this script as the project data source for actual bill content:

```text
scripts/retrieve-bill-texts.mjs
```

It starts from the normalized LEGISinfo bill metadata, finds the official Parliament `DocumentViewer` page, downloads the official bill XML, and writes normalized JSON for the app.

### Retrieve One Bill

Use this during development when someone asks for a specific bill:

```text
node --use-system-ca scripts/retrieve-bill-texts.mjs --bill C-273
```

Output:

```text
data/bills/45-1/C-273/metadata.json
data/bills/45-1/C-273/bill.xml
data/bills/45-1/C-273/bill.normalized.json
data/bills/45-1/C-273/source.json
data/bills/45-1/C-273/retrieval.json
```

### Retrieve Recommended Bills

Use this for the normal demo dataset:

```text
node --use-system-ca scripts/retrieve-bill-texts.mjs
```

Output manifest:

```text
data/bills/45-1/manifest.json
```

### Retrieve All Bills With Text

Use this when we want the broadest dataset:

```text
node --use-system-ca scripts/retrieve-bill-texts.mjs --all
```

### Smoke Test

Use this before a large refresh:

```text
node --use-system-ca scripts/retrieve-bill-texts.mjs --limit 3
```

## Current Law Retrieval

Use this script for current consolidated laws from Justice Laws:

```text
node --use-system-ca scripts/retrieve-law.mjs food-and-drugs-act
```

It reads:

```text
data/laws/registry.json
```

and writes:

```text
data/laws/current/federal/food-and-drugs-act/current.xml
data/laws/current/federal/food-and-drugs-act/current.normalized.json
data/laws/current/federal/food-and-drugs-act/source.json
```
