//go:build !windows

package main

import (
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

func collectDeviceInventory() DeviceInventory {
	inventory := DeviceInventory{IPAddresses: currentIPAddresses()}
	switch runtime.GOOS {
	case "linux", "android":
		inventory.OSVersion = linuxOSVersion()
		inventory.CPUModel = linuxCPUModel()
		inventory.MemoryTotalBytes, inventory.MemoryUsedBytes = linuxMemory()
	case "darwin":
		inventory.OSVersion = commandText("sw_vers", "-productVersion")
		inventory.CPUModel = commandText("sysctl", "-n", "machdep.cpu.brand_string")
		inventory.MemoryTotalBytes, inventory.MemoryUsedBytes = macMemory()
	}
	var disk syscall.Statfs_t
	if err := syscall.Statfs("/", &disk); err == nil && disk.Bsize > 0 {
		blockSize := uint64(disk.Bsize)
		inventory.DiskTotalBytes = uint64(disk.Blocks) * blockSize
		available := uint64(disk.Bavail) * blockSize
		if available <= inventory.DiskTotalBytes {
			inventory.DiskUsedBytes = inventory.DiskTotalBytes - available
		}
	}
	return inventory
}

func linuxOSVersion() string {
	data, err := os.ReadFile("/etc/os-release")
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"'")
			}
		}
	}
	if runtime.GOOS == "android" {
		if version := commandText("getprop", "ro.build.version.release"); version != "" {
			return "Android " + version
		}
	}
	return runtime.GOOS
}

func linuxCPUModel() string {
	data, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(parts[0]))
		if key == "model name" || key == "hardware" || key == "processor" {
			value := strings.TrimSpace(parts[1])
			if value != "" {
				return value
			}
		}
	}
	return ""
}

func linuxMemory() (uint64, uint64) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	values := make(map[string]uint64)
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		value, err := strconv.ParseUint(parts[1], 10, 64)
		if err == nil {
			values[strings.TrimSuffix(parts[0], ":")] = value * 1024
		}
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	if available == 0 {
		available = values["MemFree"] + values["Buffers"] + values["Cached"]
	}
	if available > total {
		available = total
	}
	return total, total - available
}

func macMemory() (uint64, uint64) {
	total, err := strconv.ParseUint(commandText("sysctl", "-n", "hw.memsize"), 10, 64)
	if err != nil || total == 0 {
		return 0, 0
	}
	output, err := exec.Command("vm_stat").Output()
	if err != nil {
		return total, 0
	}
	pageSize := uint64(4096)
	freePages := uint64(0)
	for _, line := range strings.Split(string(output), "\n") {
		if strings.Contains(line, "page size of ") {
			parts := strings.Fields(line)
			for index, part := range parts {
				if part == "of" && index+1 < len(parts) {
					if parsed, parseErr := strconv.ParseUint(parts[index+1], 10, 64); parseErr == nil {
						pageSize = parsed
					}
					break
				}
			}
		}
		for _, label := range []string{"Pages free:", "Pages inactive:", "Pages speculative:", "Pages purgeable:"} {
			if strings.HasPrefix(line, label) {
				value := strings.Trim(strings.TrimSpace(strings.TrimPrefix(line, label)), ".")
				if parsed, parseErr := strconv.ParseUint(value, 10, 64); parseErr == nil {
					freePages += parsed
				}
			}
		}
	}
	freeBytes := freePages * pageSize
	if freeBytes > total {
		freeBytes = total
	}
	return total, total - freeBytes
}

func commandText(name string, args ...string) string {
	output, err := exec.Command(name, args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}
