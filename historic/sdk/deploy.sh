#!/bin/bash
# to deploy docs for new release: deploy.sh release
# to update docs for prev release: deploy.sh docs
# to deploy docs for pre-release: deploy.sh prerelease

../docs/deploy.sh "$@"
