#!/bin/bash
# Show changes since last tagged release (prereleases are not tagged)
git diff $(git tag -l 'v*' --sort creatordate|tail -1) -- ../teatime ../math ../util ../reflector "$@"
