---
name: Agon Windows MSI packaging
description: Architecture limits and consent-visible pairing behavior for generated Windows installers.
---

The available Linux `wixl` tool rejects `--arch arm64`. Generate MSI only for x64; retain the native ARM64 executable with its PowerShell ZIP installer rather than labeling a mismatched package as ARM64 MSI.

**Why:** MSI database architecture affects Windows Installer behavior, and packaging the ARM64 executable in an x64 MSI was not verified on Windows.

**How to apply:** Keep the Windows x64 MSI as the default deployment option. Test a real ARM64 MSI with Windows Installer on an ARM64 VM before replacing the ARM64 ZIP fallback.
