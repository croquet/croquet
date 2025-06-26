#!/bin/bash
# usage: ./test.sh [port] [web-root-path] [files-root-path]
#   port:          port to listen on (default: 8888)
#   web-root-path: path to website root (default: ./webroot)
#   files-root-path: path to files root (default: ./_files)
# or
# ./test.sh stop

if [ x"$1" == xstop ]
then
    nginx -p `pwd` -c test-server/nginx.conf -s quit
    exit 0
fi

cd $(dirname "$0")
TOP=../..

# these are used inside docker-compose.yml
export HOST_PORT=${1:-8888}
export WEB_ROOT_PATH=${2:-./webroot}
export FILES_ROOT_PATH=${3:-./_files}
export REFLECTOR_LABEL=`hostname`

# used in Dockerfile below
REFLECTOR_PATH=$TOP/packages/reflector
REFLECTOR_ARGS="--storage=file --standalone --no-loglatency --no-logtime"

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

rm -rf test
cp -a $REFLECTOR_PATH test
mkdir test/run
rm -rf test/node_modules

cp test-server/mime.types test
cat test-server/nginx.conf | sed -e 's/\(.*\)listen\(.*\)8888/\1listen\2'"${HOST_PORT}"/ > test/nginx.conf

if [ -e test/run/nginx.pid ]
then
   nginx -p `pwd` -c test-server/nginx.conf -s reload 
else
   nginx -p `pwd` -c test-server/nginx.conf
fi

(
    cd test
    npm i
    node reflector.js $REFLECTOR_ARGS
)
