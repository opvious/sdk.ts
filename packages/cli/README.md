# Opvious CLI [![NPM version](https://img.shields.io/npm/v/opvious-cli.svg)](https://www.npmjs.com/package/opvious-cli)

A command line interface to the Opvious API.

## Quickstart

First install this package via [Node.js][]'s built-in `npm`:

```sh
npm i -g opvious-cli
```

Then set a valid [Opvious API token][token] as `OPVIOUS_TOKEN` environment
variable in your local environment (for example inside your Bash profile).

```sh
opvious me # Should show your account's email
```

## Sample usage

### Creating and listing existing formulations

Create formulations directly from local specification files (typically in
Markdown or LaTeX):

```sh
opvious formulation register -f "$NAME" sources/*
```

These can then be used to start long-running optimization attempts. You can also
list currently available formulations in your account:

```sh
opvious formulation list
```

### Interactively validating specifications

Get real-time feedback as you write a model's specification:

```sh
opvious formulation validate -w sources/*
```

[![asciicast](https://asciinema.org/a/KZ9KqW6S4n6CR9PrEOrxfPIUy.svg)](https://asciinema.org/a/KZ9KqW6S4n6CR9PrEOrxfPIUy)

### Starting a local API server

_Use of API servers is subject to the [Opvious API image
EULA](https://www.opvious.io/end-user-license-agreements/api-image)._

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

Under the hood these commands wrap `docker-compose` to manage the server's image
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
[token]: https://hub.cloud.opvious.io/authorizations.
[API server]: https://hub.docker.com/repository/docker/opvious/api-server
[API server compose]: https://github.com/opvious/sdk.ts/blob/main/packages/cli/resources/docker/compose.yaml
