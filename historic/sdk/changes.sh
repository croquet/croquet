#!/bin/bash
# Show changes since last tagged release (prereleases are not tagged)
RELEASE=$(git tag -l 'v*' --sort creatordate | tail -1)
git diff $RELEASE -- ../teatime ../math ../util ../reflector "$@"
