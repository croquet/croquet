#!/bin/bash
cd `dirname $0`

old_stash=`git rev-parse -q --verify refs/stash`
git stash -q -- src
new_stash=`git rev-parse -q --verify refs/stash`

if [ "$old_stash" != "$new_stash" ]; then
    echo "Stashing dirty files"
    git stash show
fi

DIR=../../servers/croquet.studio

APP=$DIR/demos
rm -f $APP/*
npx parcel build ./assets/*.html -d $APP/ --public-url . || exit

if [ "$old_stash" != "$new_stash" ]; then
    echo "restoring dirty files"
    git stash show
    git stash pop -q
fi

git add -A $APP/
git commit -m "[demos] deploy to croquet.studio" || exit
git show --stat

echo
echo 'You still need to "git push" to upload to https://croquet.studio/'
