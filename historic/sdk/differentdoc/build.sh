#!/bin/sh

rm -rf ./build

for i in `ls -d */| grep -v build/`
do
    (cd $i; npx jsdoc -c jsdoc.json -d ../build/$i)
done

cp index.html build/index.html

