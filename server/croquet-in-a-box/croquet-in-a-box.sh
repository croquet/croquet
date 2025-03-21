#!/bin/bash
# usage: ./croquet-in-a-box.sh [port]

cd $(dirname "$0")
TOP=$(git rev-parse --show-toplevel)

# these are used inside docker-compose.yml
export HOST_PORT=${1:-8888}
export WEB_ROOT_PATH=$TOP/website
export REFLECTOR_LABEL=`hostname`

# used in Dockerfile below
REFLECTOR_PATH=$TOP/packages/reflector
REFLECTOR_ARGS="--storage=none --standalone --no-loglatency --no-logtime"

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
echo "example: http://$HOST_IP:$HOST_PORT/multiblaster/?reflector=ws://$HOST_IP:$HOST_PORT/reflector&files=http://$HOST_IP:$HOST_PORT/files"
echo
echo "Starting croquet-in-a-box: when you see 'starting WebSocketServer' below we're up and running"

rm -rf build
cp -a $REFLECTOR_PATH build
rm -rf build/node_modules

cat > build/Dockerfile <<-EOF
FROM node:18-alpine
WORKDIR /usr/src/reflector
COPY package*.json reflector.js .pino-prettyrc ./
RUN npm ci \
    && echo "#!/bin/sh" > reflector.sh \
    && echo "node reflector.js $REFLECTOR_ARGS | npx pino-pretty" >> reflector.sh \
    && chmod +x reflector.sh
ENV LOG_LEVEL=info
ENV CLUSTER_LABEL=somewhere
EXPOSE 9090
CMD [ "./reflector.sh" ]
EOF

# run reflector and nginx as defined in docker-compose.yml
docker compose up
