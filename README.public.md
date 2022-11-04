> You'll need an Opvious API access token to use the packages below. You can
> generate one at https://hub.opvious.io/authorizations.

# Libraries

+ [`opvious`](modules/opvious.html), primary SDK. This package provides a high
  level client for interacting with the Opvious API. Start here if you are not
  sure which package to use.
+ [`opvious-graph`](modules/opvious_graph.html), lower-level GraphQL SDK. You
  may want to use this if you want to use the underlying GraphQL API types in an
  environment with strict dependency requirements (e.g. Google Apps Script).
+ [`opvious-sheets`](modules/opvious_sheets.html), spreadsheet utilities. You
  may find these useful if you want to process CSV files locally separately from
  the CLI.

# CLI

+ [`opvious-cli`](modules/opvious_cli.html), command line interface powered by
  the above SDK.
