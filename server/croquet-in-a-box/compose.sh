#!/bin/bash

export REFLECTOR_USER=reflector:reflector

# Unified environment setup
export HOST_PORT=8888
export WEB_ROOT_PATH=./webroot
export FILES_ROOT_PATH=./_files
export FILES_MOUNT_PATH=-/var/tmp/croquet-in-a-box/files
export REFLECTOR_LABEL=$(hostname)

# Run the docker command
docker compose "$@"
