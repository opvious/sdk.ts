# Opvious GraphQL API types

```sh
npm i opvious-graph
```

This package contains auto-generated types for Opvious' underlying GraphQL API.
Consider also using the higher level SDK exported by
[`opvious`](https://www.npmjs.com/package/opvious).

## Quickstart

```typescript
import {GraphQLClient} from 'graphql-request';
import {getSdk} from 'opvious-graph';

// Underlying generic GraphQL client.
const client = new GraphQLClient('https://api.opvious.io/graphql', {
  headers: {authorization: 'Bearer ' + process.env.OPVIOUS_TOKEN},
});

// Typesafe GraphQL SDK.
const sdk = getSdk(
  <R, V>(query: string, vars: V) => client.rawRequest<R, V>(query, vars)
);
```

You can generate API tokens (used via `process.env.OPVIOUS_TOKEN` above) at
https://hub.opvious.io/authorizations.

## Schema

The aggregated schema is available as `resources/schema.graphql`.
