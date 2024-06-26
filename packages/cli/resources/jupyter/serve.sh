#!/usr/bin/env bash

# Convenience script to start a Jupyter notebook server in a self-contained
# virtualenv. Additional `jupyter notebook` options may be passed in.

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
		python3 -m ensurepip
	fi
	python3 -m pip install -r "$__dirname/requirements.txt"
	jupyter notebook "$@"
}

main "$@"
