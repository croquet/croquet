#!/bin/bash
cd `dirname $0`

HTML=./assets/*.html
APP=$(basename `pwd`)

TARGET=../../servers/croquet-io-testing
CROQUET=../libraries/packages/croquet

# update @croquet/croquet package
# (even though we're only using its .env file, not the .js)
(cd $CROQUET ; npm run prepublish)

rm -f $TARGET/$APP/*
npx parcel build $HTML -d $TARGET/$APP/ --public-url . || exit

# commit to git
git add -A $TARGET/$APP
git commit -m "[$APP] deploy to croquet.io/testing" $TARGET/$APP || exit
git show --stat

echo
echo "You still need to run"
echo "    gsutil -m -h 'Cache-Control:public, max-age=60' rsync -r -c -x '^\..*|.*(.sh|\.js\.map)$' $TARGET/$APP/ gs://croquet.io/testing/$APP/"
echo "to deploy to https://croquet.io/testing/$APP/"
