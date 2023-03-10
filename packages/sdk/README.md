# Opvious SDK [![NPM version](https://img.shields.io/npm/v/opvious.svg)](https://www.npmjs.com/package/opvious)

```sh
npm i opvious
```

This package exposes a typesafe SDK for the Opvious API.

## Quickstart

> You'll need an Opvious API access token to run client methods. You can
> generate one at https://hub.beta.opvious.io/authorizations.

```typescript
import {OpviousClient} from 'opvious';

// Generates a client using the access token stored in the
// `OPVIOUS_TOKEN` environment variable. You can also pass
// one explicitly via the `authorization` option.
const client = OpviousClient.create();

// Solves an optimization model asynchronously.
const attempt = await client.startAttempt({
  formulationName: 'my-formulation',
  // ...
});
```
