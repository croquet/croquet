#!/bin/bash
# usage: ./croquet-in-a-box.sh [port]

cd $(dirname "$0")
WONDERLAND=$(git rev-parse --show-toplevel)

# these are used inside docker-compose.yml
export HOST_PORT=${1:-8000}
export WEB_ROOT_PATH=$WONDERLAND/servers/croquet-io-dev
export REFLECTOR_LABEL=`hostname`

# figure out IP address, or use localhost
# this mighht be specific to MacOS, will need to do check on Linux/Windows
HOST_IP=`ifconfig | grep "inet .* broadcast" | head -1 | awk '{print $2}'`
if [[ -z "$HOST_IP" ]] ; then
    HOST_IP=localhost
fi

echo "web: http://$HOST_IP:$HOST_PORT"
echo "files: http://$HOST_IP:$HOST_PORT/files"
echo "reflector: http://$HOST_IP:$HOST_PORT/reflector"
echo
echo "example: http://$HOST_IP:$HOST_PORT/guardians/?reflector=ws://$HOST_IP:$HOST_PORT/reflector&files=http://$HOST_IP:$HOST_PORT/files"
echo
echo "Press Ctrl-C to stop"
echo

# create Docker definition into ./dist
REFLECTOR=$WONDERLAND/croquet/reflector
$REFLECTOR/gen-obfuscated-docker.sh --storage=none --standalone --no-loglatency --no-logtime

# run reflector and nginx as defined in docker-compose.yml
docker compose up
