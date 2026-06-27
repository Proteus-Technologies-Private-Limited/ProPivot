#!/usr/bin/env bash
# Regenerate the downloadable starter zips that the docs site serves
# (React, Angular, Vue, and plain JavaScript).
#
#   1. (Re)builds the ProPivot library so dist/ is current.
#   2. Vendors the runtime dist/ files into each sample's vendor/propivot folder.
#   3. Zips each sample (without node_modules / build output) into docs/downloads/.
#
# Usage: bash samples/build-zips.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAMPLES="$ROOT/samples"
DIST="$ROOT/dist"
OUT="$ROOT/docs/downloads"

echo "==> Building ProPivot library (npm run build)"
( cd "$ROOT" && npm run build )

vendor() {
  # vendor <sample-dir>
  local sample="$1"
  local pkg="$sample/vendor/propivot"
  echo "==> Vendoring dist into $sample/vendor/propivot"
  rm -rf "$pkg"
  mkdir -p "$pkg/dist"

  # Copy the runtime + type files, but not the (large) source maps.
  for f in "$DIST"/*; do
    case "$f" in
      *.map) continue ;;
    esac
    cp "$f" "$pkg/dist/"
  done

  # A minimal package.json exposing the same entry points as the published package.
  cat > "$pkg/package.json" <<'JSON'
{
  "name": "@proteus/propivot",
  "version": "0.1.0",
  "description": "Pre-built ProPivot bundle vendored for the starter sample.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./react": {
      "types": "./dist/react.d.ts",
      "import": "./dist/react.js",
      "require": "./dist/react.cjs"
    },
    "./vue": {
      "types": "./dist/vue.d.ts",
      "import": "./dist/vue.js",
      "require": "./dist/vue.cjs"
    },
    "./global": "./dist/propivot.global.js",
    "./propivot.css": "./dist/propivot.css"
  },
  "peerDependencies": {
    "react": ">=17",
    "vue": ">=3"
  },
  "peerDependenciesMeta": {
    "react": {
      "optional": true
    },
    "vue": {
      "optional": true
    }
  }
}
JSON
}

zip_sample() {
  # zip_sample <name> <top-folder>
  # Builds a *reproducible* archive: a fixed timestamp on every entry and a
  # sorted, deterministic file list, so the bytes only change when the contents
  # do (which keeps the freshness check / auto-refresh from churning).
  local name="$1"
  local top="$2"
  local zip="$OUT/$name.zip"
  echo "==> Writing $zip"
  rm -f "$zip"
  ( cd "$SAMPLES"
    # The files we ship: source + vendored library, never install/build output.
    local find_args=(-type f
      ! -path "$top/node_modules/*"
      ! -path "$top/dist/*"
      ! -path "$top/.angular/*"
      ! -name '.DS_Store')
    # Pin every entry to a fixed mod-time for byte-stable output.
    find "$top" "${find_args[@]}" -print0 | xargs -0 touch -t 202401010000
    # Add entries in a stable, locale-independent order.
    find "$top" "${find_args[@]}" | LC_ALL=C sort | zip -X -q "$zip" -@ )
}

mkdir -p "$OUT"

vendor "$SAMPLES/react-starter"
vendor "$SAMPLES/angular-starter"
vendor "$SAMPLES/vue-starter"
vendor "$SAMPLES/vanilla-js-starter"

zip_sample "propivot-react-starter" "react-starter"
zip_sample "propivot-angular-starter" "angular-starter"
zip_sample "propivot-vue-starter" "vue-starter"
zip_sample "propivot-vanilla-js-starter" "vanilla-js-starter"

echo "==> Done. Artifacts:"
ls -lh "$OUT"
