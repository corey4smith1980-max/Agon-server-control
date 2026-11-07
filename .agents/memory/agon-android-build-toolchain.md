---
name: Agon Android build toolchain
description: Android API 37 build requirements and the JDK issue encountered in this Replit environment.
---

Build the Android agent with OpenJDK 21 and the project's Gradle wrapper. In this environment, Gradle's Android JDK image transform failed when it selected GraalVM 19's `jlink`; it succeeded after OpenJDK 21 was installed and made the active Java runtime. The Android 17/API 37 platform also needs an Android Gradle Plugin version that supports API 37.

**Why:** The first API 37 build stopped during `JdkImageTransform` under GraalVM 19. Keeping the Android toolchain on JDK 21 avoids that environment-specific failure.

**How to apply:** Keep JDK 21 available through Replit's Nix packages and use the checked-in Gradle wrapper for Android builds. The SDK is cached under the ignored `.cache/android-sdk` directory and the build script installs missing API 37 components.
