#!/bin/sh
cd `dirname "$0"`
rm -rf dist/
npm run build-prod
source .env
git update-index --no-assume-unchanged dist/croquet.min.js
git commit -m "[teatime] croquet.min.js $CROQUET_VERSION" dist/croquet.min.js
git update-index --assume-unchanged dist/croquet.min.js
git show --stat
