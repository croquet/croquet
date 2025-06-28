#!/bin/bash

#export REFLECTOR_USER=`id -u`:`id -g` 
export REFLECTOR_USER=1000:1000

# Determine mode and shift args
MODE="$1"
shift

case "$MODE" in
    attached)
        CMD="docker compose up"
        ;;
    down)
        CMD="docker compose down"
        ;;
    *)
        # run reflector and nginx as defined in docker-compose.yml. it is detached with -d option.
        CMD="docker compose up -d"
        set -- "$MODE" "$@"  # Put $1 back into the list if not a recognized keyword
        ;;
esac

# Unified environment setup
export HOST_PORT=${1:-8888}
export WEB_ROOT_PATH=${2:-./webroot}
export FILES_ROOT_PATH=${3:-./_files}
export FILES_MOUNT_PATH=${4:-/var/tmp/croquet-in-a-box/files}
export REFLECTOR_LABEL=$(hostname)

# Run the docker command
$CMD
