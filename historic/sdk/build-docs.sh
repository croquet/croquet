#!/bin/bash
cd `dirname "$0"`
VERSION="$@"
if [ -z "$VERSION" ] ; then
    echo "Usage: `basename $0` <version>"
    exit 1
fi

rm -r build/*

node_modules/.bin/jsdoc -c jsdoc.json -d build
[ $? -ne 0 ] && exit

sed -i~ "s/@CROQUET_VERSION@/$VERSION/" build/*.html
[ $? -ne 0 ] && exit

rm -f build/*.html~

echo "Built docs: `pwd`/build/index.html"
