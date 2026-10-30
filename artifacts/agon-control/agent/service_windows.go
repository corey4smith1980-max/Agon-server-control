//go:build windows

package main

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"

	"golang.org/x/sys/windows/svc"
)

type windowsAgentService struct {
	configPath string
	config     Config
}

func (s *windowsAgentService) Execute(_ []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		_ = runAgent(ctx, s.config, s.configPath)
		close(done)
	}()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
	for {
		select {
		case request := <-requests:
			switch request.Cmd {
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				<-done
				return false, 0
			case svc.Interrogate:
				status <- request.CurrentStatus
			}
		case <-done:
			return false, 0
		}
	}
}

func maybeRunPlatformService(configPath string, cfg Config) (bool, error) {
	isService, err := svc.IsWindowsService()
	if err != nil || !isService {
		return isService, err
	}
	return true, svc.Run("AgonAgent", &windowsAgentService{configPath: configPath, config: cfg})
}

func installPlatform(configPath string) error {
	executable, config, err := prepareInstalledFiles(configPath, `C:\Program Files\Agon`, `C:\ProgramData\Agon`)
	if err != nil {
		return err
	}
	binPath := fmt.Sprintf(`"%s" -config "%s"`, executable, config)
	commands := [][]string{
		{"create", "AgonAgent", "binPath=", binPath, "start=", "auto", "DisplayName=", "Agon Agent"},
		{"description", "AgonAgent", "Consent-based remote inventory and diagnostics"},
		{"start", "AgonAgent"},
	}
	for _, args := range commands {
		output, err := exec.Command("sc.exe", args...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("sc.exe %v: %w: %s", args, err, output)
		}
	}
	return nil
}

func uninstallPlatform() error {
	_ = exec.Command("sc.exe", "stop", "AgonAgent").Run()
	output, err := exec.Command("sc.exe", "delete", "AgonAgent").CombinedOutput()
	if err != nil {
		return fmt.Errorf("remove service: %w: %s", err, output)
	}
	_ = exec.Command("cmd", "/c", "rmdir", "/s", "/q", filepath.Clean(`C:\Program Files\Agon`)).Run()
	return nil
}
