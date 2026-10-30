//go:build (linux && !android) || darwin

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func maybeRunPlatformService(_ string, _ Config) (bool, error) { return false, nil }

func installPlatform(configPath string) error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("service installation requires administrator/root privileges")
	}
	if runtime.GOOS == "darwin" {
		return installLaunchDaemon(configPath)
	}
	executable, config, err := prepareInstalledFiles(configPath, "/opt/agon-agent", "/etc/agon-agent")
	if err != nil {
		return err
	}
	_ = exec.Command("useradd", "--system", "--home", "/nonexistent", "--shell", "/usr/sbin/nologin", "agonagent").Run()
	_ = exec.Command("chown", "agonagent:agonagent", config).Run()
	_ = os.Chmod(config, 0600)
	unit := fmt.Sprintf(`[Unit]
 Description=Agon consent-based endpoint agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
 User=agonagent
 Group=agonagent
ExecStart=%s -config %s
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
 ReadWritePaths=/etc/agon-agent

[Install]
WantedBy=multi-user.target
`, executable, config)
	if err := os.WriteFile("/etc/systemd/system/agon-agent.service", []byte(unit), 0644); err != nil {
		return err
	}
	for _, args := range [][]string{{"daemon-reload"}, {"enable", "agon-agent.service"}, {"restart", "agon-agent.service"}} {
		if output, err := exec.Command("systemctl", args...).CombinedOutput(); err != nil {
			return fmt.Errorf("systemctl %v: %w: %s", args, err, output)
		}
	}
	return nil
}

func installLaunchDaemon(configPath string) error {
	executable, config, err := prepareInstalledFiles(configPath, "/usr/local/libexec/agon-agent", "/Library/Application Support/Agon")
	if err != nil {
		return err
	}
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.agon.agent</string>
<key>ProgramArguments</key><array><string>%s</string><string>-config</string><string>%s</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>/var/log/agon-agent.log</string>
<key>StandardErrorPath</key><string>/var/log/agon-agent.log</string>
</dict></plist>`, executable, config)
	path := "/Library/LaunchDaemons/com.agon.agent.plist"
	if err := os.WriteFile(path, []byte(plist), 0644); err != nil {
		return err
	}
	output, err := exec.Command("launchctl", "bootstrap", "system", path).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl bootstrap: %w: %s", err, output)
	}
	return nil
}

func uninstallPlatform() error {
	if os.Geteuid() != 0 {
		return fmt.Errorf("uninstall requires administrator/root privileges")
	}
	if runtime.GOOS == "darwin" {
		path := "/Library/LaunchDaemons/com.agon.agent.plist"
		_ = exec.Command("launchctl", "bootout", "system", path).Run()
		_ = os.Remove(path)
		return nil
	}
	_ = exec.Command("systemctl", "disable", "--now", "agon-agent.service").Run()
	_ = os.Remove("/etc/systemd/system/agon-agent.service")
	_ = exec.Command("systemctl", "daemon-reload").Run()
	_ = os.RemoveAll(filepath.Clean("/opt/agon-agent"))
	return nil
}
