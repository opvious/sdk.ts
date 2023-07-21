# Opvious CLI [![NPM version](https://img.shields.io/npm/v/opvious-cli.svg)](https://www.npmjs.com/package/opvious-cli)

A [Node.js][] command line interface to the Opvious API.

```sh
npm i -g opvious-cli
```

## Configuration

By default the CLI connects to the Opvious cloud API. It can also be configured
to connect to a self-hosted [API server][] by setting the `OPVIOUS_ENDPOINT`
environment variable correspondingly, for example `http://localhost:8080` (see
also [Starting an API server](#starting-an-api-server) below).

In both cases, most commands require a valid API token to be set as
`OPVIOUS_TOKEN` environment variable. Cloud API tokens can be generated
[here][authorizations]; refer to the API server documentation to learn how to
authenticate in the self-hosted case.

You can check that your CLI is authenticated by running the following command:

```sh
opvious me # Should show your account's email
```


## Sample commands

### Managing API tokens

The CLI allows you to list, create, and revoke your API tokens.

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

These can then be used to start long-running optimization attempts. You can also
list currently available formulations in your account:

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
along with its dependencies ([`compose.yaml`][API server compose]).


## Next steps

You can view the full list of available commands by running:

```sh
opvious -h
```

### Configuration profiles

As an alternative to `OPVIOUS_TOKEN`, the CLI supports reading a configuration
file from `~/.config/opvious/cli.yml` (this location can be changed by setting
the `OPVIOUS_CONFIG` environment variable). This configuration allows declaring
multiple profiles to access the API.

```yaml
# Sample configuration with two profiles
profiles:
  - name: default
    token: ... # Cloud API token
  - name: local
    endpoint: http://localhost:8080
```

By default the first profile from the configuration is selected. You can select
another one by specifying the `-P, --profile` flag when running any command.

```sh
opvious -P local formulation list
```


[Node.js]: https://nodejs.org
[authorizations]: https://hub.cloud.opvious.io/authorizations.
[API server]: https://hub.docker.com/repository/docker/opvious/api-server
[API server compose]: https://github.com/opvious/sdk.ts/blob/main/packages/cli/resources/docker/compose.yaml
