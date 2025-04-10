#!/bin/sh
set -e
cd `dirname "$0"`

./build.sh

HEAD=`sed '/\*\// q' pub/croquet.min.js`
VERSION=`echo "$HEAD" | grep Version: | sed 's/.*Version: //'`
PRERELEASE=true

case $VERSION in
    "") echo "ERROR: Version comment not found in\n$HEAD"
        exit 1
        ;;
    *+*) echo "WARN: don't publish a dirty version: $VERSION"
        exit 0
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
