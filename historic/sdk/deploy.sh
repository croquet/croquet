#!/bin/bash
# to redeploy docs only: deploy.sh docs
# to bump minor (x.y.0-0): deploy.sh preminor
# to bump patch (x.y.z-0): deploy.sh prepatch
# to prerelease (x.y.z-p): deploy.sh prepatch
# for release (x.y.z): deploy.sh sdk

cd `dirname "$0"`

WHAT="$1"
VERSION=$(git tag --list @croquet/croquet\* | tail -1 | sed 's/.*@//')
[ $? -ne 0 ] && exit 1

case "$WHAT" in
prerelease|prepatch|preminor|premajor)
    VERSION=`npm version $WHAT`
    [ $? -ne 0 ] && exit 1
    MSG="prerelease $VERSION"
    PRERELEASE=true
    BUILDDOCS=false
    ;;
docs)
    MSG="docs $VERSION"
    PRERELEASE=false
    BUILDDOCS=true
    ;;
sdk)
    npm version "$VERSION"
    [ $? -ne 0 ] && exit 1
    MSG="sdk+docs $VERSION"
    PRERELEASE=false
    BUILDDOCS=true
    ;;
*)
    DEPLOY=`basename $0`
    echo "Usage: $DEPLOY (sdk|docs|prerelease|prepatch|preminor|premajor)"
    exit 1
esac

echo "DEPLOYING $MSG"

DIR=../../servers/croquet.studio
SDK=$DIR/sdk
DOCS=$SDK/docs
SRC_PKG=../libraries/packages/croquet

if [ "$WHAT" != "docs" ] ; then
    # update @croquet/croquet package
    (cd $SRC_PKG ; npm run prepublish)

    # build & deploy library
    npx parcel build --public-url . --global Croquet -d $SDK -o croquet-$VERSION.min.js croquet.js

    # always link as latest-pre
    (cd $SDK; ln -sf croquet-$VERSION.min.js croquet-latest-pre.min.js; ln -sf croquet-$VERSION.min.js.map croquet-latest-pre.min.js.map)
    # link as latest unless prerelease
    $PRERELEASE || (cd $SDK; ln -sf croquet-$VERSION.min.js croquet-latest.min.js; ln -sf croquet-$VERSION.min.js.map croquet-latest.min.js.map)
fi

# build docs unless pre-release
if $BUILDDOCS ; then
    rm -r build/*
    npx jsdoc -c jsdoc.json -d build || exit
    sed -i '' "s/@CROQUET_VERSION@/$VERSION/" build/*.html || exit

    # deploy docs
    rm -r $DOCS/*
    # (fake conduct.html to fool parcel)
    touch build/conduct.html
    npx parcel build --public-url . --no-source-maps -d $DOCS build/*.html || exit
    # (remove fake conduct.html and substitute proper link)
    rm $DOCS/conduct.html
    sed -i '' "s|conduct.html|/conduct.html|" $DOCS/index.html
fi

git add -A $SDK/ package.json package-lock.json
git commit -m "[sdk] deploy $MSG to croquet.studio" || exit

git show --stat

echo
echo 'You still need to "git push" to upload to https://croquet.studio/'
