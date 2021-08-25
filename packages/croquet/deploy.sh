#!/bin/sh
cd `dirname "$0"`
rm -rf cjs/ pub/
(cd ../../../util ; npm ci --production)
(cd ../../../math ; npm ci --production)
(cd ../../../teatime ; npm ci --production)
npm ci
npm run build-prod || exit

HEAD=`sed '/\*\// q' pub/croquet.min.js`
VERSION=`echo "$HEAD" | grep Version: | sed 's/.*Version: //'`
PRERELEASE=true

case $VERSION in
    "") echo "ERROR: Version comment not found in\n$HEAD"
        exit 1
        ;;
    *+*) echo "ERROR: won't deploy a dirty version: $VERSION"
        exit 1
        ;;
    *-*) PRERELEASE=true
        ;;
    *) PRERELEASE=false
esac

# publish pub/croquet.min.js to croquet.io/dev/sdk
TARGET=../../../../servers/croquet-io-dev
LIB=$TARGET/lib
sed 's,//# sourceMappingURL.*,,' pub/croquet.min.js > $LIB/croquet-$VERSION.min.js
$PRERELEASE && cat prerelease.js >> $LIB/croquet-$VERSION.min.js
cp pub/croquet.min.js.map $LIB/croquet-$VERSION.min.js.map

# always create croquet-latest-pre.txt
(cd $LIB; ln -sf croquet-$VERSION.min.js croquet-latest-pre.min.js; echo $VERSION > croquet-latest-pre.txt)

# create croquet-latest.txt unless prerelease
$PRERELEASE || (cd $LIB; echo $VERSION > croquet-latest.txt)

# deploy docs (no commit)
DOCS=docs
if $PRERELEASE ; then
    ../../../sdk/deploy.sh prerelease || exit
    DOCS="docs-pre"
else
    ../../../sdk/deploy.sh release || exit
    DOCS="docs"
fi

# commit
FILES="cjs/croquet-croquet.js cjs/croquet-croquet.js.map pub/croquet.min.js pub/croquet.min.js.map"
git update-index --no-assume-unchanged $FILES
git add -A cjs/ pub/ $LIB/ $TARGET/$DOCS/
git commit -m "[teatime] deploy $VERSION" cjs/ pub/ $LIB/ $TARGET/$DOCS/ || exit
git update-index --assume-unchanged $FILES
git --no-pager show --stat

echo "Next, publish the npm:"
if $PRERELEASE ; then
    echo "    npm publish --tag pre"
else
    echo "    npm publish"
fi
echo "After pushing to dev, you might want to"
echo "    ../../../../docker/scripts/deploy-from-dev-to-test.sh lib"
echo "    ../../../../docker/scripts/release-from-test-to-public.sh lib"
echo "    ../../../../docker/scripts/deploy-from-dev-to-test.sh $DOCS/croquet"
echo "    ../../../../docker/scripts/release-from-test-to-public.sh $DOCS/croquet"
