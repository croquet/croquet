#!/bin/sh

rm -rf ./build

for i in croquet virtual-dom
do
    (cd $i; npx jsdoc -c jsdoc.json -d ../build/$i)
done

cp index.html build/index.html

