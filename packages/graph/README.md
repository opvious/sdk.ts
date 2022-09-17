# Opvious GraphQL API types

```sh
npm i opvious-graph
```

This package contains types for Opvious' underlying GraphQL API. Consider also
using the higher level SDK available via
[`opvious`](https://www.npmjs.com/package/opvious).

## Quickstart

```ts
import {GraphQLClient} from 'graphql-request';
import {getSdk} from 'opvious-graph';

const client = new GraphQLClient("https://api.opvious.io/graphql");
const sdk = getSdk(
  <R, V>(query: string, vars: V) => client.rawRequest<R, V>(query, vars)
);
```
