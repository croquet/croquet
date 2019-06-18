#!/bin/bash
cd `dirname "$0"`

old_stash=`git rev-parse -q --verify refs/stash`
git stash -q -- .
new_stash=`git rev-parse -q --verify refs/stash`

if [ "$old_stash" != "$new_stash" ]; then
    echo "Stashing dirty files"
    git stash show
fi

DIR=../../servers/croquet.studio
VERSION=`npm version prerelease`

SDK=$DIR/sdk
DOCS=$SDK/docs
rm -rf $DOCS/*
rm -rf build/*

# build docs
npm run build-docs
npx parcel build --public-url . --no-source-maps -d $DOCS build/*html

# build library
npx parcel build --public-url . --global Croquet -d $SDK -o croquet-$VERSION.min.js croquet.js

if [ "$old_stash" != "$new_stash" ]; then
    echo "restoring dirty files"
    git stash show
    git stash pop -q
fi

git add -A $SDK/ package.json package-lock.json
git commit -m "[sdk] deploy $VERSION to croquet.studio" || exit
git show --stat

echo
echo 'You still need to "git push" to upload to https://croquet.studio/'
