#!/bin/bash
# for pre-releases (x.y.z-p): deploy.sh
# for patch release (x.y.z): deploy.sh patch
# for minor release (x.y.0): deploy.sh minor

cd `dirname "$0"`

RELEASE="$1"
[ -z "$RELEASE" ] && RELEASE=prerelease
VERSION=`npm version $RELEASE`
[ $? -ne 0 ] && exit

echo "DEPLOYING $VERSION"

old_stash=`git rev-parse -q --verify refs/stash`
git stash -q -- .
new_stash=`git rev-parse -q --verify refs/stash`

if [ "$old_stash" != "$new_stash" ]; then
    echo "Stashing dirty files"
    git stash show
fi


# build docs
rm -r build/*
npx jsdoc -c jsdoc.json -d build
[ $? -ne 0 ] && exit
sed -i~ "s/@CROQUET_VERSION@/$VERSION (pre-alpha)/" build/*.html
[ $? -ne 0 ] && exit

# clean old
DIR=../../servers/croquet.studio
SDK=$DIR/sdk
DOCS=$SDK/docs
rm -r $DOCS/*

# deploy docs
npx parcel build --public-url . --no-source-maps -d $DOCS build/*.html

# build & deploy library
npx parcel build --public-url . --global Croquet -d $SDK -o croquet-$VERSION.min.js croquet.js

# link as latest
(cd $SDK; ln -sf croquet-$VERSION.min.js croquet-latest.min.js; ln -sf croquet-$VERSION.min.js.map croquet-latest.min.js.map)

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
