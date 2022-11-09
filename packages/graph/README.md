# Opvious GraphQL API types [![NPM version](https://img.shields.io/npm/v/opvious-graph.svg)](https://www.npmjs.com/package/opvious-graph)

```sh
npm i opvious-graph
```

This package contains auto-generated types for Opvious' underlying GraphQL API.
Consider also using the higher level SDK exported by
[`opvious`](https://www.npmjs.com/package/opvious).

## Quickstart

> You'll need an Opvious API access token to call SDK methods. You can
> generate one at https://hub.opvious.io/authorizations.

```typescript
import {GraphQLClient} from 'graphql-request';
import {getSdk} from 'opvious-graph';

// Underlying generic GraphQL client.
const client = new GraphQLClient('https://api.opvious.io/graphql', {
  headers: {authorization: process.env.OPVIOUS_TOKEN},
});

// Typesafe GraphQL SDK.
const sdk = getSdk(
  <R, V>(query: string, vars: V) => client.rawRequest<R, V>(query, vars)
);
```
