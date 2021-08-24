#!/bin/bash
# to deploy docs for new release: deploy.sh release
# to deploy docs for pre-release: deploy.sh prerelease

DIR=`dirname "$0"`
$DIR/../docs/deploy.sh "$@"
