#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
node scripts/build-android-apk.mjs package
BUILD_ANDROID_APK=1 node scripts/build-downloads.mjs
