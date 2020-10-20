#!/bin/sh
cd `dirname "$0"`
rm -rf cjs/ pub/
(cd ../../../util ; npm ci --production)
(cd ../../../math ; npm ci --production)
(cd ../../../teatime ; npm ci --production)
npm ci
npm run build-prod || exit 1

HEAD=`head -6 cjs/croquet-croquet.js`
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

# publish pub/croquet.min.js to croquet.io/testing/sdk
SDK=../../../../servers/croquet-io-testing/sdk
cp pub/croquet.min.js $SDK/croquet-$VERSION.min.js
cp pub/croquet.min.js.map $SDK/croquet-$VERSION.min.js.map

# always link as latest-pre
(cd $SDK; ln -sf croquet-$VERSION.min.js croquet-latest-pre.min.js; echo $VERSION > croquet-latest-pre.txt)

# link as latest unless prerelease
$PRERELEASE || (cd $SDK; ln -sf croquet-$VERSION.min.js croquet-latest.min.js; echo $VERSION > croquet-latest.txt)

# commit
FILES="cjs/croquet-croquet.js cjs/croquet-croquet.js.map pub/croquet.min.js pub/croquet.min.js.map"
git update-index --no-assume-unchanged $FILES
git add -A cjs/ pub/ $SDK/
git commit -m "[teatime] deploy $VERSION" cjs/ pub/ $SDK/ || exit 1
git update-index --assume-unchanged $FILES
git --no-pager show --stat


echo "For public release, do not forget to"
echo "    ../../../../docker/scripts/deploy-to-public-from-testing.sh sdk"
