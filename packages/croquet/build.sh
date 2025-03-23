#!/bin/sh
cd `dirname "$0"`
rm -rf cjs/ pub/
(cd math ; npm ci --production)
(cd teatime ; npm ci --production)
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

echo "Next, publish the npm:"
if $PRERELEASE ; then
    echo "    npm publish --tag dev"
else
    echo "    npm publish"
fi
