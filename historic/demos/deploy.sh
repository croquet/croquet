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
OLD=../../servers/croquet.studio-old

DATE=`git log -1 --pretty='%ci' $DIR | sed 's/ [^ ]*$//;s/[-:]//g;s/ /-/'`
SHORT_DATE=`echo $DATE | sed 's/-.*//'`
rm -rf "$OLD/$SHORT_DATE"*
mkdir -p "$OLD/$DATE"
cp -a $DIR/* "$OLD/$DATE/"
git add -A "$OLD/"
git commit --no-verify -m "deploy croquet.studio/old/$DATE/"

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
