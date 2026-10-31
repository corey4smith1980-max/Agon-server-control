package main

import (
	"net"
	"sort"
)

type DeviceInventory struct {
	OSVersion        string
	CPUModel         string
	IPAddresses      []string
	MemoryTotalBytes uint64
	MemoryUsedBytes  uint64
	DiskTotalBytes   uint64
	DiskUsedBytes    uint64
}

func currentIPAddresses() []string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	addresses := make([]string, 0, 8)
	seen := make(map[string]struct{})
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		values, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, value := range values {
			var ip net.IP
			switch address := value.(type) {
			case *net.IPNet:
				ip = address.IP
			case *net.IPAddr:
				ip = address.IP
			}
			if ip == nil || ip.IsLoopback() || ip.IsUnspecified() {
				continue
			}
			text := ip.String()
			if _, exists := seen[text]; exists {
				continue
			}
			seen[text] = struct{}{}
			addresses = append(addresses, text)
			if len(addresses) == 12 {
				break
			}
		}
		if len(addresses) == 12 {
			break
		}
	}
	sort.Strings(addresses)
	return addresses
}
