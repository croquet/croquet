#!/bin/bash
cd `dirname $0`

HTML=./assets/*.html
APP=$(basename `pwd`)

TARGET=../../servers/croquet.studio
CROQUET=../libraries/packages/croquet

# update @croquet/croquet package
# (even though we're only using its .env file, not the .js)
(cd $CROQUET ; npm run prepublish)

rm -f $TARGET/$APP/*
npx parcel build $HTML -d $TARGET/$APP/ --public-url . || exit

# commit to git
git add -A $TARGET/$APP
git commit -m "[$APP] deploy to croquet.studio" $TARGET/$APP || exit
git show --stat

echo
echo "You still need to"
echo "    git push"
echo "to upload to https://croquet.studio/$APP/ and"
echo "    ../../docker/scripts/croquet-studio-to-croquet-io.sh"
echo "to deploy to https://croquet.io/$APP/"
