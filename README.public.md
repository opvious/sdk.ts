# Overview

## Libraries

+ [`opvious`](modules/opvious.html), main SDK. Start here if you are not sure
  which package to use.
+ [`opvious-graph`](modules/opvious_graph.html), lower-level GraphQL SDK. Use
  this if you want to use the underlying GraphQL types in an environment with
  strict dependency requirements (e.g. Google Apps Script).
+ [`opvious-sheets`](modules/opvious_cli.html), spreadsheet utilities.

## Dependency graph

```mermaid
flowchart TB
  g[opvious-graph] --> o[opvious]
  g --> s[opvious-sheets]
  o --> c[opvious-cli]
  s --> c
  click g "modules/opvious_graph.html" "opvious-graph"
  click o "modules/opvious.html" "opvious"
  click s "modules/opvious_sheets.html" "opvious-sheets"
  click c "modules/opvious_cli.html" "opvious-cli"
```
