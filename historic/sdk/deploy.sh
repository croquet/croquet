#!/bin/bash
# to redeploy docs only: deploy.sh docs
# to deploy docs and sdk: deploy.sh release
# to deploy prerelease sdk: deploy.sh prerelease

cd `dirname "$0"`

WHAT="$1"
VERSION=$(cd ../libraries/packages/croquet;node -p -e "require('./package.json').version")
RELEASEVERSION=$(git tag --list @croquet/croquet\* | tail -1 | sed 's/.*@//')
[ $? -ne 0 ] && exit 1

case "$VERSION" in
    *-*)
        PRERELEASE=true
        ;;
    *)
        PRERELEASE=false;
esac


case "$WHAT" in
docs)
    MSG="docs $RELEASEVERSION"
    BUILDDOCS=true
    ;;
prerelease)
    if ! $PRERELEASE ; then
        echo "$VERSION does not look like a pre-release version!"
        exit 0
    fi
    npm version "$VERSION"
    [ $? -ne 0 ] && exit 1
    MSG="prerelease $VERSION"
    npm version "$VERSION"
    BUILDDOCS=false
    ;;
release)
    if $PRERELEASE ; then
        echo "$VERSION looks like a pre-release version!"
        exit 0
    fi
    if [ "$VERSION" != "$RELEASEVERSION" ] ; then
        echo "package.json's $VERSION does not equal latest tag $RELEASEVERSION"
        exit 1
    fi
    npm version "$VERSION"
    [ $? -ne 0 ] && exit 1
    MSG="sdk+docs $VERSION"
    PRERELEASE=false
    BUILDDOCS=true
    ;;
*)
    DEPLOY=`basename $0`
    echo "Usage: $DEPLOY (release|prerelease|docs)"
    exit 1
esac

echo "DEPLOYING $MSG"

DIR=../../servers/croquet-io-testing
SDK=$DIR/sdk
DOCS=$SDK/docs
SRC_PKG=../libraries/packages/croquet

if [ "$WHAT" != "docs" ] ; then
    # update @croquet/croquet package
    (cd $SRC_PKG ; npm run prepublish)

    # build & deploy library
    npx parcel build --public-url . --global Croquet -d $SDK -o croquet-$VERSION.min.js sdk.js

    # always link as latest-pre
    (cd $SDK; ln -sf croquet-$VERSION.min.js croquet-latest-pre.min.js; ln -sf croquet-$VERSION.min.js.map croquet-latest-pre.min.js.map)
    # link as latest unless prerelease
    $PRERELEASE || (cd $SDK; ln -sf croquet-$VERSION.min.js croquet-latest.min.js; ln -sf croquet-$VERSION.min.js.map croquet-latest.min.js.map)
fi

# build docs unless pre-release
if $BUILDDOCS ; then
    rm -r build/*
    npx jsdoc -c jsdoc.json -d build || exit
    sed -i '' "s/@CROQUET_VERSION@/$RELEASEVERSION/" build/*.html || exit

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
git commit -m "[sdk] deploy $MSG to croquet.io/test" $SDK/ package.json package-lock.json || exit

git show --stat

echo
echo "You still need to run"
echo "    ../../docker/scripts/deploy-to-croquet-io-testing.sh"
echo "to deploy to https://croquet.io/testing/"
