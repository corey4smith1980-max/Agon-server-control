//go:build windows

package main

import (
	"fmt"
	"os"
	"runtime"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

type windowsMemoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

var globalMemoryStatusEx = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")

func collectDeviceInventory() DeviceInventory {
	inventory := DeviceInventory{IPAddresses: currentIPAddresses()}
	version := windows.RtlGetVersion()
	if version != nil {
		inventory.OSVersion = fmt.Sprintf("Windows %d.%d (build %d)", version.MajorVersion, version.MinorVersion, version.BuildNumber)
	}
	if inventory.OSVersion == "" {
		inventory.OSVersion = runtime.GOOS
	}
	if key, err := registry.OpenKey(
		registry.LOCAL_MACHINE,
		`HARDWARE\DESCRIPTION\System\CentralProcessor\0`,
		registry.QUERY_VALUE,
	); err == nil {
		inventory.CPUModel, _, _ = key.GetStringValue("ProcessorNameString")
		_ = key.Close()
	}
	var memory windowsMemoryStatusEx
	memory.Length = uint32(unsafe.Sizeof(memory))
	if result, _, _ := globalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&memory))); result != 0 {
		inventory.MemoryTotalBytes = memory.TotalPhys
		if memory.AvailPhys <= memory.TotalPhys {
			inventory.MemoryUsedBytes = memory.TotalPhys - memory.AvailPhys
		}
	}
	root := os.Getenv("SystemDrive")
	if root == "" {
		root = "C:"
	}
	if len(root) == 2 {
		root += `\`
	}
	if drive, err := windows.UTF16PtrFromString(root); err == nil {
		var freeAvailable, total, free uint64
		if windows.GetDiskFreeSpaceEx(drive, &freeAvailable, &total, &free) == nil {
			inventory.DiskTotalBytes = total
			if free <= total {
				inventory.DiskUsedBytes = total - free
			}
		}
	}
	return inventory
}
