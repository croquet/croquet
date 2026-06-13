#!/bin/bash

# To configure this package build, set the environment variable `REGISTRY_NAMESPACE`
# to your Docker account name, and optionally set `LABEL`
docker build . --build-arg LABEL=${LABEL:-$(git branch --show-current)} -t "${REGISTRY_NAMESPACE:-croquet}/reflector:$(git branch --show-current)-$(date -u +'%Y-%m-%d-%H-%M')"
