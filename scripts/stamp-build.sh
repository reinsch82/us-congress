#!/bin/sh
# Stamps a build ID into an assembled site directory so browsers never mix files
# from two deploys: asset URLs get ?v=<id>, and every page and js/common.js carry the
# ID so a script can reload a stale cached page (see checkBuild in js/common.js).
# Usage: scripts/stamp-build.sh <site-dir> <build-id>
set -eu
dir=$1
id=$2
for page in "$dir"/*.html; do
  sed -i.bak \
    -e "s|<meta name=\"build\" content=\"dev\">|<meta name=\"build\" content=\"$id\">|" \
    -e "s|href=\"css/\([a-z-]*\)\.css\"|href=\"css/\1.css?v=$id\"|g" \
    -e "s|src=\"js/\([a-z-]*\)\.js\"|src=\"js/\1.js?v=$id\"|g" \
    "$page"
done
for script in "$dir"/js/*.js; do
  sed -i.bak \
    -e "s|^export const BUILD = 'dev';|export const BUILD = '$id';|" \
    -e "s|from './\([a-z-]*\)\.js';|from './\1.js?v=$id';|" \
    "$script"
done
rm "$dir"/*.html.bak "$dir"/js/*.bak
