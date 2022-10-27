# Opvious SDK

```sh
npm i opvious
```

This package exposes a typesafe SDK for the Opvious API.

## Quickstart

> You'll need an Opvious API access token to run client methods. You can
> generate one at https://hub.opvious.io/authorizations.

```typescript
import {OpviousClient} from 'opvious';

// Generates a client using the token stored in the `OPVIOUS_AUTHORIZATION`
// environment variable. You can also pass one explicitly via the
// `authorization` option.
const client = OpviousClient.create();

// Creates a new specification from a source string.
await client.registerSpecification({
  formulationName: 'my-formulation',
  source: '...',
});

// Runs an optimization using the passed in parameters.
const attempt = await client.runAttempt({
  formulationName: 'my-formulation',
  parameters: [/* ... */],
});
```

As a convenience, this package also reexports `opvious-graph` as `graph`.
