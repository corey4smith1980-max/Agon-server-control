//go:build android

package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func maybeRunPlatformService(_ string, _ Config) (bool, error) { return false, nil }

func installPlatform(configPath string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	base := filepath.Join(home, ".agon-agent")
	_, config, err := prepareInstalledFiles(configPath, base, base)
	if err != nil {
		return err
	}
	fmt.Printf("Agent installed in %s. Start it with: %s -config %s\n", base, filepath.Join(base, "agon-agent"), config)
	fmt.Println("For boot persistence and kiosk deployment, deploy this agent through your Android MDM. No hidden persistence is configured.")
	return nil
}

func uninstallPlatform() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(home, ".agon-agent"))
}
