#!/bin/sh

./build.sh

VERSION="${VERSION:-0.5.0}"
MINOR_VERSION="${MINOR_VERSION:-""}"

echo $VERSION $MINOR_VERSION

sed -i '' "s/@CROQUET_VERSION@/$VERSION/;s/@CROQUET_VERSION_MINOR@/$MINOR_VERSION/;" build/*/*.html || exit
