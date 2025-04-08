#!/bin/bash
# RUN THIS TO UPDATE TO THE LATEST CROQUET VERSION
# This script updates the Croquet version in all apps

shopt -s nullglob
IFS=$'\n\t'
cd `dirname $0`

CROQUET_VERSION=`npm view @croquet/croquet@dev version`

echo "Version: $CROQUET_VERSION"

HTML=(
    ./data-test/data-test.html
    ./hello-live/index.html
    ./threejs/index.html
    ./youtube/index.html
    ../server/croquet-in-a-box/webroot/multiblaster/index.html
    ../server/croquet-in-a-box/webroot/multicar/index.html
    ../server/croquet-in-a-box/webroot/postcard/index.html
)

NPM_I=(
    ./2d
    ./chat
    ./hello_node
    ./hello-typescript
    ./hello_rollup
    ./video
)

NPM_I_LATEST=(
    ./pix
    ./rapier2d
)

for F in "${HTML[@]}"; do
    # skip if it already has the version
    if grep -q "@croquet/croquet@$CROQUET_VERSION[^-.0-9a-f]" $F; then
        echo "$F already patched"
        continue
    fi
    echo "Patching $F"
    sed -i.bak "s|@croquet/croquet@[-.0-9]*|@croquet/croquet@$CROQUET_VERSION|g" $F
    rm $F.bak
done

# packages linking to ../packages/croquet
for D in "${NPM_I[@]}"; do
    echo "Updating $D"
    (cd $D && npm install --silent)
done

# packages linking to croquet on npm
for D in "${NPM_I_LATEST[@]}"; do
    echo "Updating $D"
    (cd $D && npm install --silent --save @croquet/croquet@$CROQUET_VERSION)
done
