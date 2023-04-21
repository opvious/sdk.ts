# Opvious CLI [![NPM version](https://img.shields.io/npm/v/opvious-cli.svg)](https://www.npmjs.com/package/opvious-cli)

A command line interface to the Opvious API.

## Quickstart

First install this package via [Node.js][]'s built-in `npm`:

```sh
npm i opvious-cli
```

Then set a valid [Opvious API token][token] as `OPVIOUS_TOKEN` environment
variable in your local environment (for example inside your Bash profile).

```sh
opvious me # Should show your account's email
opvious -h # Shows the list of available commands
```

## Next steps

### Profiles

As an alternative to `OPVIOUS_TOKEN`, the CLI supports reading a configuration
file from `~/.config/opvious/cli.yml` (this location can be changed by setting
the `OPVIOUS_CONFIG` environment variable):

This configuration allows declaring multiple profiles to access the API 

```yaml
profiles:
  - name: first
    authorization: $FIRST_OPVIOUS_TOKEN
  - name: second
    authorization: $SECOND_OPVIOUS_TOKEN
```

By default the first profile from the configuration is selected. You can select
another one by specifying the `-P, --profile` flag when running any command.


[Node.js]: https://nodejs.org
[token]: https://hub.beta.opvious.io/authorizations.
