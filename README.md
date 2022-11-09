# Opvious TypeScript SDK

## Artifacts

### NPM packages

+ [`opvious`](packages/sdk), primary SDK. This package provides a high level
  client for interacting with the Opvious API. Start here if you are not sure
  which package to use.
+ [`opvious-cli`](packages/cli), command line interface powered by
  the above SDK.
+ [`opvious-sheets`](packages/sheets), spreadsheet utilities. You may find these
  useful if you want to process CSV files locally separately from the CLI.

TypeDoc documentation: https://opvious.github.io/sdk.ts

## Developing

```sh
$ pnpm i
$ pnpm dlx husky install # Set up git hooks, only needed once
```
