# Laws

This folder is for current law, not proposed bills.

Bills live in:

```text
data/bills/
```

Current laws live in:

```text
data/laws/current/
```

## How Laws Are Retrieved

1. A bill tells us which Act it amends.
   - Example: `S-202` amends the `Food and Drugs Act`.
   - We detect this from the bill title, bill XML clauses, and normalized `targetActs`.

2. The Act is matched to `registry.json`.
   - The registry stores the official Justice Laws HTML and XML URLs.
   - This avoids guessing URLs inside app code.

3. `scripts/retrieve-law.mjs` downloads the official Justice Laws XML.

4. The script writes both source XML and normalized JSON.

For the Food and Drugs Act:

```text
data/laws/current/federal/food-and-drugs-act/current.xml
data/laws/current/federal/food-and-drugs-act/current.normalized.json
data/laws/current/federal/food-and-drugs-act/source.json
```

For the C-273 demo, the current-law baseline includes the five federal Acts named in the bill:

```text
data/laws/current/federal/feeds-act/
data/laws/current/federal/fertilizers-act/
data/laws/current/federal/seeds-act/
data/laws/current/federal/pest-control-products-act/
data/laws/current/federal/food-and-drugs-act/
```

The C-273 law pack lives at:

```text
data/laws/c-273-demo-laws.json
```

## Refresh

```text
node --use-system-ca scripts/retrieve-law.mjs food-and-drugs-act
```

Refresh every law in the registry:

```text
node --use-system-ca scripts/retrieve-law.mjs --all
```

## Important Distinction

```text
Bill text = proposed change
Current law = law as it exists today
Comparison = proposed bill applied against current law
```

So the app pipeline should be:

```text
bill.normalized.json
  -> identify target law
  -> registry.json
  -> current law XML from Justice Laws
  -> current.normalized.json
  -> amendment/diff engine
```
