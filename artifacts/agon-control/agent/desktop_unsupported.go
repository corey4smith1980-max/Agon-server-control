//go:build !windows

package main

import "errors"

func confirmDesktopConsent(_, _, _, _ string) (bool, error) {
	return false, errors.New("interactive desktop sharing is currently supported only by the Windows companion")
}

func cancelDesktopConsent() {}

func captureDesktopJPEG() ([]byte, int, int, error) {
	return nil, 0, 0, errors.New("interactive desktop capture is currently supported only by the Windows companion")
}

func applyDesktopInput(DesktopInput) error {
	return errors.New("interactive desktop input is currently supported only by the Windows companion")
}
