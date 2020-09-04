#!/bin/sh
cd `dirname "$0"`
rm -rf pub/
npm run build-prod || exit 1
source .env
rm .env

case $CROQUET_VERSION in
    *+*) echo "ERROR: won't deploy a dirty version: $CROQUET_VERSION"
        exit 1
esac

git update-index --no-assume-unchanged pub/croquet-croquet.js
git commit -m "[teatime] croquet-croquet.js $CROQUET_VERSION" pub/croquet-croquet.js || exit 1
git update-index --assume-unchanged pub/croquet-croquet.js
git show --stat

case $CROQUET_VERSION in
*-*) ../../../sdk/deploy.sh prerelease ;;
*) ../../../sdk/deploy.sh release ;;
esac
