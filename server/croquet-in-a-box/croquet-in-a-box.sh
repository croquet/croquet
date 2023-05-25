#!/bin/bash
cd $(dirname "$0")

echo "web: http://localhost:8000"
echo "files: http://localhost:8000/files"
echo "reflector: http://localhost:8000/reflector"
echo
echo "example: http://localhost:8000/guardians/?reflector=ws://localhost:8000/reflector&files=http://localhost:8000/files/"
echo
echo "Press Ctrl-C to stop"
echo

# create Docker definition into ./dist
WONDERLAND=$(git rev-parse --show-toplevel)
REFLECTOR=$WONDERLAND/croquet/reflector
$REFLECTOR/gen-obfuscated-docker.sh --storage=none --standalone --no-loglatency --no-logtime

# run reflector and nginx as defined in docker-compose.yml
export HOST_PORT=8000
export WEB_ROOT_PATH=$WONDERLAND/servers/croquet-io-dev
export REFLECTOR_LABEL=`hostname`
docker compose up
