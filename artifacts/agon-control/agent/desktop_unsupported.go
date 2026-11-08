//go:build !windows

package main

import "errors"

func confirmDesktopConsent(_, _, _, _ string) (bool, error) {
	return false, errors.New("interactive desktop sharing is currently supported only by the Windows companion")
}

func cancelDesktopConsent() {}

type MonitorInfo struct {
	Index   int  `json:"index"`
	X       int  `json:"x"`
	Y       int  `json:"y"`
	Width   int  `json:"width"`
	Height  int  `json:"height"`
	Primary bool `json:"primary"`
}

func listMonitors() []MonitorInfo {
	return []MonitorInfo{{Index: 0, Width: 0, Height: 0, Primary: true}}
}

func captureDesktopJPEG(monitorIndex int) ([]byte, int, int, error) {
	return nil, 0, 0, errors.New("interactive desktop capture is currently supported only by the Windows companion")
}

func applyDesktopInput(DesktopInput) error {
	return errors.New("interactive desktop input is currently supported only by the Windows companion")
}
