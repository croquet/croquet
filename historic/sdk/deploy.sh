#!/bin/bash
# to deploy docs for new release: deploy.sh release
# to update docs for prev release: deploy.sh docs
# add --commit to commit result

cd `dirname "$0"`

WHAT="$1"
OPTION="$2"
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
    ;;
*)
    DEPLOY=`basename $0`
    echo "Usage: $DEPLOY (release|docs) [--commit]"
    exit 1
esac

COMMIT=false
case "$OPTION" in
    "--commit")
        COMMIT=true
        ;;
    "")
        COMMIT=false
        ;;
    *)
    DEPLOY=`basename $0`
    echo "Usage: $DEPLOY (release|docs) [--commit]"
    exit 1
esac

if $COMMIT ; then
    echo "DEPLOYING AND COMMITTING DOCS FOR $VERSION"
else
    echo "BUILDING $VERSION DOCS WITHOUT COMMITTING"
fi

DIR=../../servers/croquet-io-testing
SDK=$DIR/sdk
DOCS=$SDK/docs

rm -rf build/*
npx jsdoc -c jsdoc.json -d build || exit
sed -i '' "s/@CROQUET_VERSION@/$RELEASEVERSION/" build/*.html || exit

# clean old docs
rm -r $DOCS/*
# (fake conduct.html to fool parcel)
touch build/conduct.html
npx parcel build --public-url . --no-source-maps -d $DOCS build/*.html || exit
# (remove fake conduct.html and substitute proper link)
rm $DOCS/conduct.html
sed -i '' "s|conduct.html|/conduct.html|" $DOCS/index.html

$COMMIT || exit

git add -A $SDK/ package.json
git commit -m "[sdk] deploy docs $RELEASEVERSION to croquet.io/testing" $SDK/ package.json || exit

git --no-pager show --stat

echo
echo "You still need to"
echo "    git push"
echo "to deploy to https://croquet.io/testing/"
