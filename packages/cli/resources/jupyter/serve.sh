#!/usr/bin/env bash

# Convenience script to start a Jupyter notebook server in a self-contained
# virtualenv. Additional `jupyter notebook` options may be passed when running
# the command, for example `./scripts/start-server.sh --ip xx.local` to expose
# the server on the local network.

set -o nounset
set -o errexit
set -o pipefail
shopt -s nullglob

__dirname="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

main() { # <folder> [...]
	if [ -d venv ]; then
		. venv/bin/activate
	else
		python3 -m venv venv
		. venv/bin/activate
	fi
	pip install -r "$__dirname/requirements.txt"
	jupyter notebook "$@"
}

main "$@"
