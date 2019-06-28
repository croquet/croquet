#!/bin/bash
# Show changes since last tagged release (prereleases are not tagged)
#git log $(git describe --tags --abbrev=0)..HEAD -p -- ../teatime ../util ../reflector "@"
git diff $(git describe --tags --abbrev=0) -- ../teatime ../util ../reflector "$@"
