#!/bin/bash
# usage: ./croquet-in-a-box.sh [port]

cd $(dirname "$0")
WONDERLAND=$(git rev-parse --show-toplevel)

# these are used inside docker-compose.yml
export HOST_PORT=${1:-8888}
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

REFLECTOR_ARGS="--storage=none --standalone --no-loglatency --no-logtime"
$WONDERLAND/croquet/reflector/gen-obfuscated-docker.sh $REFLECTOR_ARGS
cp ../reflector-standalone/.pino-prettyrc dist/
cat > dist/Dockerfile <<-EOF
FROM node:18-alpine AS BUILD_IMAGE
WORKDIR /usr/src/reflector
COPY package*.json reflector.js .pino-prettyrc ./
RUN npm ci \
    && echo "#!/bin/sh" > reflector.sh \
    && echo "node reflector.js $REFLECTOR_ARGS | npx pino-pretty" >> reflector.sh \
    && chmod +x reflector.sh

FROM node:18-alpine
ENV LOG_LEVEL=info
ENV CLUSTER_LABEL=somewhere
WORKDIR /usr/src/reflector
COPY --from=BUILD_IMAGE /usr/src/reflector/ ./
EXPOSE 9090
CMD [ "./reflector.sh" ]
EOF

# run reflector and nginx as defined in docker-compose.yml
docker compose up
