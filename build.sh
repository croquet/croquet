#!/bin/bash
# This script is used to build example applications from `/apps`
# into the root `_site` directory for upload to GitHub Pages.

set -e

cd $(dirname "$0")

TOP=$(pwd)

APPS=(
    2d
    chat
    hello
    hello-live
    pix
    rapier2d
    threejs
    video
    youtube
)

mkdir -p _site
rm -rf _site/*

# build croquet first
echo "👷‍♀️ Building Croquet..."
(cd packages/croquet && ./build.sh)
echo

HTML=""
NOT_BUILT=""
for APP in "${APPS[@]}"; do
    echo
    echo "👷‍♀️ Building $APP..."
    cd "apps/$APP"

    if [[ $(type -t $APP) == function ]] ; then
        # If there is a build function with the same name, call it
        $APP
    elif [ -f package.json ]; then
        # If there is a package.json file, run the build script
        npm ci
        npm run build
        cp -rv dist "$TOP/_site/$APP"
        cd "$TOP/_site"
        for f in $APP/*.html; do
            HTML="$HTML <li><a href=\"$f\">$f</a></li>"
        done
    elif [ -f index.html ]; then
        # If there is an index.html file, copy everything
        mkdir -p "$TOP/_site/$APP"
        cp -rv * "$TOP/_site/$APP/"
        HTML="$HTML <li><a href=\"$APP/index.html\">$APP/index.html</a></li>"
    else
        echo "No build script found for $APP"
        NOT_BUILT="$NOT_BUILT $APP"
    fi
    cd "$TOP"
done

# Create the index.html file
echo
echo "👷‍♀️ Creating index.html..."
cat <<__EOF__ > _site/index.html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Croquet Apps Auto Build</title>
    <style>
        body { font-family: monospace; }
        li { margin: .5em 0; }
    </style>
</head>
<body>
    <h1>Croquet Apps Auto Build</h1>
    <p>These are Croquet apps automatically built from the
    <a href="https://github.com/croquet/croquet/tree/main/apps">Croquet repository</a>.</p>
    <ul>
        $HTML
    </ul>
</body>
</html>
__EOF__

if [ -n "$NOT_BUILT" ]; then
    echo
    echo "❌ The following apps were not built: $NOT_BUILT"
fi