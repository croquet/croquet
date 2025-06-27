#!/bin/bash
# usage: ./build.sh [port] [web-root-path] [files-root-path] [files-mount-path]
#   port:          port to listen on (default: 8888)
#   web-root-path: path to website root (default: ./webroot)
#   files-root-path: path to files root (default: ./_files)
#   files-mount-path: the path to use from within the containers. See also docker-compose.yml (default: /var/tmp/croquet-in-a-box/files)

cd $(dirname "$0")
TOP=../..

export REFLECTOR_USER=1000:1000

# these are used inside docker-compose.yml
export HOST_PORT=${1:-8888}
export WEB_ROOT_PATH=${2:-./webroot}
export FILES_ROOT_PATH=${3:-./_files}
export FILES_MOUNT_PATH=${4:-/var/tmp/croquet-in-a-box/files}
export REFLECTOR_LABEL=`hostname`

# used in Dockerfile below
REFLECTOR_PATH=$TOP/packages/reflector
REFLECTOR_ARGS="--storage=file --standalone --no-loglatency --no-logtime"

rm -rf build
cp -a $REFLECTOR_PATH build
rm -rf build/node_modules

cat > build/Dockerfile <<-EOF
FROM node:18-alpine
WORKDIR /usr/src/reflector
COPY package*.json reflector.js localfs.js .pino-prettyrc ./
RUN apk add --update python3 make g++\
   && rm -rf /var/cache/apk/*
RUN npm ci \
    && echo "#!/bin/sh" > reflector.sh \
    && echo "node reflector.js $REFLECTOR_ARGS | npx pino-pretty" >> reflector.sh \
    && chmod +x reflector.sh
ENV LOG_LEVEL=info
ENV CLUSTER_LABEL=somewhere
ENV FILES_MOUNT_PATH=$FILES_MOUNT_PATH
EXPOSE 9090
CMD [ "./reflector.sh" ]
EOF

# run reflector and nginx as defined in docker-compose.yml
docker compose build reflector
