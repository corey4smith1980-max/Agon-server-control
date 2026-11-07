#!/bin/sh
set -eu

node scripts/build-android-apk.mjs prepare
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-../../.cache/android-sdk}}"
SDK_ROOT="$(cd "$SDK_ROOT" && pwd)"
(
  cd android-agent
  ANDROID_HOME="$SDK_ROOT" ANDROID_SDK_ROOT="$SDK_ROOT" ./gradlew --no-daemon packageAgentArtifacts
)
