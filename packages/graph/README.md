# Opvious GraphQL API types

```sh
npm i opvious-graph
```

This package contains auto-generated types for Opvious' underlying GraphQL API.
Consider also using the higher level SDK available via
[`opvious`](https://www.npmjs.com/package/opvious).

## Quickstart

```ts
import {GraphQLClient} from 'graphql-request';
import {ENDPOINT, getSdk} from 'opvious-graph';

// Underlying generic GraphQL client.
const client = new GraphQLClient(ENDPOINT, {
  headers: {authorization: process.env.OPVIOUS_TOKEN},
});

// Typesafe GraphQL SDK.
const sdk = getSdk(
  <R, V>(query: string, vars: V) => client.rawRequest<R, V>(query, vars)
);
```

You can generate API tokens (used via `process.env.OPVIOUS_TOKEN` above) at
https://hub.opvious.io/authorizations.
