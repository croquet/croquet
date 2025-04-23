#!/bin/sh
set -e
cd `dirname "$0"`

case "$1" in
    prod)
        BUILD=prod
        ;;
    dev)
        BUILD=dev
        ;;
    *)
        BRANCH=`git rev-parse --abbrev-ref HEAD`
        if [ "$BRANCH" = "main" ]; then
            BUILD=prod
        else
            BUILD=dev
        fi
        ;;
esac


rm -rf cjs/ pub/
(cd math ; npm ci)
(cd teatime ; npm ci)
npm ci

if [ "$BUILD" = "prod" ]; then
    npm run build-prod
else
    npm run build-dev
fi
