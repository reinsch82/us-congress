#!/bin/sh
# Stamps a build ID into an assembled site directory so browsers never mix files
# from two deploys: asset URLs get ?v=<id>, and the page and app.js both carry the
# ID so app.js can reload a stale cached page (see checkBuild in js/app.js).
# Usage: scripts/stamp-build.sh <site-dir> <build-id>
set -eu
dir=$1
id=$2
sed -i.bak \
  -e "s|<meta name=\"build\" content=\"dev\">|<meta name=\"build\" content=\"$id\">|" \
  -e "s|href=\"css/style.css\"|href=\"css/style.css?v=$id\"|" \
  -e "s|src=\"js/app.js\"|src=\"js/app.js?v=$id\"|" \
  -e "s|src=\"js/contact.js\"|src=\"js/contact.js?v=$id\"|" \
  "$dir/index.html"
sed -i.bak \
  -e "s|^const BUILD = 'dev';|const BUILD = '$id';|" \
  -e "s|from './\([a-z]*\)\.js';|from './\1.js?v=$id';|" \
  "$dir/js/app.js"
sed -i.bak -e "s|from './\([a-z]*\)\.js';|from './\1.js?v=$id';|" "$dir/js/model.js"
rm "$dir"/index.html.bak "$dir"/js/*.bak
