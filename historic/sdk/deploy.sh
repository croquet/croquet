#!/bin/bash
# to deploy docs for new release: deploy.sh release
# to update docs for prev release: deploy.sh docs
# to deploy docs for pre-release: deploy.sh prerelease

# https://stackoverflow.com/questions/59895/how-can-i-get-the-source-directory-of-a-bash-script-from-within-the-script-itsel
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
$DIR/../docs/deploy.sh "$@"
