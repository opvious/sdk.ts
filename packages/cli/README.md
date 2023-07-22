# Opvious CLI [![NPM version](https://img.shields.io/npm/v/opvious-cli.svg)](https://www.npmjs.com/package/opvious-cli)

A [Node.js][] command line interface to the [Opvious][] API.

```sh
npm i -g opvious-cli
```

## Configuration

By default the CLI connects to the Opvious cloud API. It can also be configured
to connect to a self-hosted [API server][] by setting the `OPVIOUS_ENDPOINT`
environment variable accordingly (see also
[Starting an API server](#starting-an-api-server) below).

In both cases, most commands require a valid API token to be set as
`OPVIOUS_TOKEN` environment variable. Cloud API tokens can be generated
[here][authorizations]; refer to the API server documentation to learn how to
authenticate in the self-hosted case. You can check that your CLI is
authenticated by running the following command:

```sh
opvious me # Should show your account's email
```

For more complex setups, check out the [Configuration
profiles](#configuration-profiles) section below.


## Sample commands

### Solve a problem

The first step is to represent the problem as a
[`SolveCandidate`](https://api.cloud.opvious.io/schema.json?name=SolveCandidate)
and save it as JSON or YAML. In general you wouldn't write it manually but it's
simple enough to do for small problems. For example a set-cover instance looks
like:

```yaml
# candidate.yaml
formulation:
  sources:
    - | # Set cover formulation
      + $\S^d_{vertices}: V$
      + $\S^d_{sets}: S$
      + $\S^p_{coverage}: c \in \{0,1\}^{S \times V}$
      + $\S^v_{usage}: \alpha \in \{0,1\}^S$
      + $\S^o_{minimizeSetsUsed}: \min \sum_{s \in S} \alpha_s$
      + $\S^c_{allVerticesCovered}: \forall v \in V, \sum_{s \in S} \alpha_s c_{s, v} \geq 1$
inputs:
  parameters:
    - label: coverage
      entries:
        - {key: [s1, v1]}
        - {key: [s2, v2]}
        - {key: [s3, v1]}
        - {key: [s3, v2]}
```

With the candidate saved, we're ready to start solving. The solve's status (e.g.
number of LP iterations, relative gap, ...) will be shown in real time in the
terminal.

```sh
opvious solve run candidate.yaml -o outputs.yaml
```

[![asciicast](https://asciinema.org/a/n4AiNKhUY22i1A9VhPF06c1wp.svg)](https://asciinema.org/a/n4AiNKhUY22i1A9VhPF06c1wp)

If the problem was feasible the solution's outputs (variable and constraint
slack values) will be printed to the terminal unless the `-o, --output` option
was set.

```yaml
# outputs.yaml
constraints:
  - label: allVerticesCovered
    entries:
      - {key: [v1], value: 0}
      - {key: [v2], value: 0}
variables:
  - label: usage
    entries:
      - {key: [s3], value: 1}
```

Note that solves are subject to size and time limits which depend on your
account's tier. For large problems, consider also using `queue` instead of `run`
to benefit from longer timeouts. This command will queue an asynchronous solve
attempt which will run as soon as capacity is available.


### Managing API tokens

You can list, create, and revoke your API tokens using the `account`
subcommands:

```sh
opvious account authorizations # List all tokens
opvious account generate-authorization # Create a new API token
opvious account revoke-authorization # Revoke an existing API token
```


### Managing formulations

You can create formulations directly from local specification files (typically
in Markdown or LaTeX):

```sh
opvious formulation register -f "$NAME" sources/*
```

These can then be used to queue solves. You can also list currently available
formulations in your account:

```sh
opvious formulation list
```


### Validating specifications

Get real-time feedback as you write a model's specification:

```sh
opvious formulation validate -w sources/*
```

[![asciicast](https://asciinema.org/a/KZ9KqW6S4n6CR9PrEOrxfPIUy.svg)](https://asciinema.org/a/KZ9KqW6S4n6CR9PrEOrxfPIUy)


### Starting an API server

Start an [API server][] locally on port 8080:

```sh
opvious api start
```

You can then use this API's endpoint instead of the default Opvious cloud API by
setting the `OPVIOUS_ENDPOINT` environment variable to `http://localhost:8080`.
Consider for example creating an alternate configuration profile pointing to it
(see below).

The following commands may also be useful:

```sh
opvious api start -h # View available options (custom port, ...)
opvious api stop # Stop the server
opvious api logs # View server logs
```

Under the hood these commands wrap `docker compose` to manage the server's image
along with its dependencies.


## Next steps

You can view the full list of available commands by running:

```sh
opvious -h
```

### Configuration profiles

As an alternative to `OPVIOUS_ENDPOINT` and `OPVIOUS_TOKEN` environment
variables, the CLI supports reading a configuration file from
`~/.config/opvious/cli.yml` (this location can be changed by setting the
`OPVIOUS_CONFIG` environment variable). This configuration allows declaring
multiple profiles to access the API.

```yaml
# Sample configuration with two profiles
profiles:
  - name: default
    token: ... # Cloud API token
  - name: local
    endpoint: http://localhost:8080
```

By default the first profile from the configuration is selected unless the
`OPVIOUS_TOKEN` environment variable is also set, in which case profiles are
ignored. You can select a profile explicitly by specifying the `-P, --profile`
flag when running any command, this will take precedence over `OPVIOUS_TOKEN`.


[Node.js]: https://nodejs.org
[Opvious]: https://www.opvious.io
[authorizations]: https://hub.cloud.opvious.io/authorizations.
[API server]: https://hub.docker.com/r/opvious/api-server
