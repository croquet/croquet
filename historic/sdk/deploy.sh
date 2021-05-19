#!/bin/bash
# to deploy docs for new release: deploy.sh release
# to update docs for prev release: deploy.sh docs
# to deploy docs for pre-release: deploy.sh prerelease
# add --commit to commit result

cd `dirname "$0"`

WHAT="$1"
OPTION="$2"
VERSION=$(cd ../libraries/packages/croquet;node -p -e "require('./package.json').version")
DOCSVERSION=$(node -p -e "require('./package.json').version")
[ $? -ne 0 ] && exit 1

case "$VERSION" in
    *-*)
        PRERELEASE=true
        PRE="-pre"
        ;;
    *)
        PRERELEASE=false;
        PRE=""
esac


PARCEL_OPT=""
case "$WHAT" in
docs)
    VERSION="$DOCSVERSION"
    PRERELEASE=false
    PRE=""
    ;;
prerelease)
    PARCEL_OPT="--no-minify"
    ;;
release)
    if $PRERELEASE ; then
        echo "$VERSION looks like a pre-release version!"
        exit 0
    fi
    if [ "$VERSION" != "$DOCSVERSION" ] ; then
        echo "edit sdk docs version $DOCSVERSION to equal sdk package version $VERSION"
        exit 1
    fi
    [ $? -ne 0 ] && exit 1
    ;;
*)
    DEPLOY=`basename $0`
    echo "Usage: $DEPLOY (prerelease|release|docs) [--commit]"
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
    echo "Usage: $DEPLOY (prerelease|release|docs) [--commit]"
    exit 1
esac

if $COMMIT ; then
    echo "DEPLOYING AND COMMITTING DOCS FOR $VERSION"
else
    echo "BUILDING $VERSION DOCS WITHOUT COMMITTING"
fi

DIR=../../servers/croquet-io-dev
DOCS=$DIR/sdk/docs$PRE

rm -rf build/*
npx jsdoc -c jsdoc.json -d build || exit
sed -i '' "s/@CROQUET_VERSION@/$VERSION/" build/*.html || exit

# clean old docs
rm -rf $DOCS/*
# (fake conduct.html to fool parcel)
touch build/conduct.html
npx parcel build $PARCEL_OPT --public-url . --no-source-maps -d $DOCS build/*.html || exit

# (remove fake conduct.html and substitute proper link)
rm $DOCS/conduct.html
sed -i '' "s|conduct.html|/conduct.html|" $DOCS/index.html

$COMMIT || exit 0

git add -A $DOCS/ package.json
git commit -m "[sdk] deploy docs $VERSION to croquet.io/dev/sdk/docs$PRE" $DOCS/ package.json || exit

git --no-pager show --stat

echo
echo "You still need to"
echo "    git push"
echo "to deploy to https://croquet.io/dev/"
