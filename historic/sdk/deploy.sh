#!/bin/bash
# for pre-releases (x.y.z-p): deploy.sh
# for patch release (x.y.z): deploy.sh patch
# for minor release (x.y.0): deploy.sh minor

cd `dirname "$0"`

RELEASE="$1"

case "$RELEASE" in
docs)
    VERSION=`node -p "require('./package').version"`
    MSG="docs"
    [ $? -ne 0 ] && exit 1
    ;;
prerelease|prepatch|patch|preminor|minor|premajor|major)
    VERSION=`npm version $RELEASE|sed s/^v//`
    MSG="$VERSION"
    [ $? -ne 0 ] && exit 1
    ;;
*)
    DEPLOY=`basename $0`
    echo "Usage: $DEPLOY docs"
    echo "       to just deploy updated documentation and tutorials"
    echo
    echo "       or to bump version number (see https://gist.github.com/leonardokl/a08ee626067ee81ced66acef115e7ced)"
    echo "       $DEPLOY prerelease (e.g. x.y.z-1)"
    echo "       $DEPLOY prepatch   (e.g. 0.0.1-0)"
    echo "       $DEPLOY preminor   (e.g. 0.1.0-0)"
    echo "       $DEPLOY patch      (e.g. 0.0.1)"
    echo "       $DEPLOY minor      (e.g. 0.1.0)"
    exit 1
esac

echo "DEPLOYING $MSG"

# old_stash=`git rev-parse -q --verify refs/stash`
# git stash -q -- .
# new_stash=`git rev-parse -q --verify refs/stash`

# if [ "$old_stash" != "$new_stash" ]; then
#     echo "Stashing dirty files"
#     git stash show
# fi


# build docs
rm -r build/*
npx jsdoc -c jsdoc.json -d build
[ $? -ne 0 ] && exit
sed -i '' "s/@CROQUET_VERSION@/$VERSION (pre-alpha)/" build/*.html
[ $? -ne 0 ] && exit

# clean old
DIR=../../servers/croquet.studio
SDK=$DIR/sdk
DOCS=$SDK/docs
rm -r $DOCS/*

# deploy docs
npx parcel build --public-url . --no-source-maps -d $DOCS build/*.html

TAG=""

if [ "$RELEASE" != "docs" ] ; then
    echo CROQUET_VERSION='"'$VERSION' (pre-alpha)"' > .env.production
    echo CROQUET_VERSION='"'$VERSION'_dev (pre-alpha)"' > .env.development

    # build & deploy library
    npx parcel build --public-url . --global Croquet -d $SDK -o croquet-$VERSION.min.js croquet.js

    LINK=croquet-latest
    case "$RELEASE" in
    pre*) LINK=croquet-latest-pre ;;
    *) TAG="$RELEASE release $VERSION";;
    esac

    # link as latest or latest-pre
    (cd $SDK; ln -sf croquet-$VERSION.min.js $LINK.min.js; ln -sf croquet-$VERSION.min.js.map $LINK.min.js.map)
fi

# if [ "$old_stash" != "$new_stash" ]; then
#     echo "restoring dirty files"
#     git stash show
#     git stash pop -q
# fi

git add -A $SDK/ .env.production package.json package-lock.json
git commit -m "[sdk] deploy $MSG to croquet.studio" || exit

if [ -n "$TAG" ] ; then
    git tag -a v$VERSION -m "$TAG"
fi

git show --stat

echo
echo 'You still need to "git push" to upload to https://croquet.studio/'
