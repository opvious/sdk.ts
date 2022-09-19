# Opvious SDK

```sh
npm i opvious
```

This package exposes a minimal SDK for the Opvious API.

## Quickstart

You'll need an Opvious API access token to run most client methods. You can
generate one at https://hub.opvious.io/authorizations. With it, you can
instantiate a client as follows:

```typescript
import {OpviousClient} from 'opvious';

// Generates a client using the token stored in the `OPVIOUS_TOKEN`
// environment variable. You can also pass one explicitly via the
// `accessToken` option.
const client = OpviousClient.create();

// Creates a new specification from a source string.
await client.registerSpecification({
  formulationName: 'my-formulation',
  source: '...',
});

// Runs an optimization using the passed in parameters.
const outcome = await client.runAttempt({
  formulationName: 'my-formulation',
  parameters: [/* ... */],
});
```
