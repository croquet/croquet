#!/bin/sh
cd `dirname "$0"`
rm -rf pub/
npm run build-prod
source .env
git update-index --no-assume-unchanged pub/croquet-croquet.js
git commit -m "[teatime] croquet-croquet.js $CROQUET_VERSION" pub/croquet-croquet.js
git update-index --assume-unchanged pub/croquet-croquet.js
git show --stat
