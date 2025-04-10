#!/bin/sh
set -e
cd `dirname "$0"`

BRANCH=`git rev-parse --abbrev-ref HEAD`

rm -rf cjs/ pub/
(cd math ; npm ci)
(cd teatime ; npm ci)
npm ci
if [ "$BRANCH" = "main" ]; then
    npm run build-prod
else
    npm run build-dev
fi
