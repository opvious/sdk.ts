# Opvious SDK [![NPM version](https://img.shields.io/npm/v/opvious.svg)](https://www.npmjs.com/package/opvious)

```sh
npm i opvious
```

This package exposes a typesafe SDK for the Opvious API.

## Quickstart

```typescript
import {OpviousClient} from 'opvious';

// Generates a client using the access token stored in the `OPVIOUS_TOKEN`
// environment variable, if any. You can also pass one explicitly via the
// `token` option.
const client = OpviousClient.create();

// Solves an optimization problem
client.runSolve({/* Input data */})
  .on('solving', (progress) => {
    console.log(`Solving... [gap=${progress.relativeGap}]`);
  })
  .on('solved', (outcome) => {
    console.log(`${outcome.status} solve. [value=${outcome.objectiveValue}]`);
  });
```
