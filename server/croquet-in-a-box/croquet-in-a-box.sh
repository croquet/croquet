#!/bin/bash
# usage: ./croquet-in-a-box.sh [port] [web-root-path] [files-root-path]
#   port:          port to listen on (default: 8888)
#   web-root-path: path to website root (default: ./webroot)
#   files-root-path: path to files root (default: ./_files)

cd $(dirname "$0")
TOP=../..

# these are used inside docker-compose.yml
export HOST_PORT=${1:-8888}
export WEB_ROOT_PATH=${2:-./webroot}
export FILES_ROOT_PATH=${3:-./_files}
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

echo "web server:   http://$HOST_IP:$HOST_PORT           (serving $WEB_ROOT_PATH)"
echo "file server:  http://$HOST_IP:$HOST_PORT/files     (writing $FILES_ROOT_PATH)"
echo "reflector:    http://$HOST_IP:$HOST_PORT/reflector"
echo
echo "example: http://$HOST_IP:$HOST_PORT/multiblaster/?box=/"
echo "         where ?box=/ is a shortcut for ?reflector=/reflector&files=/files"
echo "         which resolve to the full URLs above"
echo

rm -rf build
cp -a $REFLECTOR_PATH build
rm -rf build/node_modules

cat > build/reflector.sh <<-EOF
#!/bin/sh
node reflector.js $REFLECTOR_ARGS \
  | npx pino-pretty -Sctlm message
EOF

cat > build/Dockerfile <<-EOF
FROM node:18-alpine
RUN apk add --update python3 make g++ \
   && rm -rf /var/cache/apk/*
WORKDIR /usr/src/reflector
COPY *.json *.js ./
RUN npm ci
COPY reflector.sh ./
RUN chmod +x reflector.sh
ENV LOG_LEVEL=info
ENV CLUSTER_LABEL=CroquetInABox
EXPOSE 9090
CMD [ "./reflector.sh" ]
EOF

# run reflector and nginx as defined in docker-compose.yml
docker compose up
