# Opvious CLI

```sh
npm i opvious-cli
```

This package provides a command line interface to the Opvious API.

## Quickstart

> You'll need an API access token to run commands. You can generate one at
> https://hub.opvious.io/authorizations.

To get started, create a configuration file with at least one profile (its
location can be changed by setting the `OPVIOUS_CONFIG` environment variable):

```yml
# ~/.config/opvious/cli.yml
profiles:
  - name: my-profile
    authorization: $OPVIOUS_TOKEN # API access token
```

You should now be able to run all CLI commands, for example:

```sh
$ opvious formulation list # List available formulations
$ opvious -h # Show help message
```

By default the first profile from the configuration is selected. You can run
with another one by specifying the `-P, --profile` flag.
