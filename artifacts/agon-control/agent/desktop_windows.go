//go:build windows

package main

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"math"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	biRGB            = 0
	dibRGBColors     = 0
	srccopy          = 0x00CC0020
	maxDesktopWidth  = 1920
	maxDesktopHeight = 1080
)

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

type bitmapInfo struct {
	Header bitmapInfoHeader
	Colors [1]uint32
}

var (
	user32Desktop              = windows.NewLazySystemDLL("user32.dll")
	gdi32Desktop               = windows.NewLazySystemDLL("gdi32.dll")
	procGetDC                  = user32Desktop.NewProc("GetDC")
	procReleaseDC              = user32Desktop.NewProc("ReleaseDC")
	procGetSystemMetrics       = user32Desktop.NewProc("GetSystemMetrics")
	procMessageBox             = user32Desktop.NewProc("MessageBoxW")
	procFindWindow             = user32Desktop.NewProc("FindWindowW")
	procPostMessage            = user32Desktop.NewProc("PostMessageW")
	procSetCursorPos           = user32Desktop.NewProc("SetCursorPos")
	procMouseEvent             = user32Desktop.NewProc("mouse_event")
	procKeybdEvent             = user32Desktop.NewProc("keybd_event")
	procCreateCompatibleDC     = gdi32Desktop.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32Desktop.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32Desktop.NewProc("SelectObject")
	procBitBlt                 = gdi32Desktop.NewProc("BitBlt")
	procGetDIBits              = gdi32Desktop.NewProc("GetDIBits")
	procDeleteObject           = gdi32Desktop.NewProc("DeleteObject")
	procDeleteDC               = gdi32Desktop.NewProc("DeleteDC")
)

func confirmDesktopConsent(customer, technician, issue, code string) (bool, error) {
	text := fmt.Sprintf(
		"Agon interactive support request\n\nCustomer: %s\nTechnician: %s\nRequest: %s\nCode: %s\n\nAllow this person to view and control the current desktop? Your screen and input will be shared until the session ends. Choose No to decline.",
		strings.TrimSpace(customer),
		strings.TrimSpace(technician),
		strings.TrimSpace(issue),
		strings.TrimSpace(code),
	)
	message, err := windows.UTF16PtrFromString(text)
	if err != nil {
		return false, err
	}
	title, err := windows.UTF16PtrFromString("Agon Desktop Support — consent required")
	if err != nil {
		return false, err
	}
	result, _, callErr := procMessageBox.Call(0, uintptr(unsafe.Pointer(message)), uintptr(unsafe.Pointer(title)), 0x00000004|0x00000040)
	if result == 6 { // IDYES
		return true, nil
	}
	if result == 7 { // IDNO
		return false, nil
	}
	if callErr != windows.ERROR_SUCCESS {
		return false, callErr
	}
	return false, errors.New("desktop consent dialog did not return a decision")
}

func cancelDesktopConsent() {
	title, err := windows.UTF16PtrFromString("Agon Desktop Support — consent required")
	if err != nil {
		return
	}
	handle, _, _ := procFindWindow.Call(0, uintptr(unsafe.Pointer(title)))
	if handle != 0 {
		procPostMessage.Call(handle, 0x0010, 0, 0) // WM_CLOSE
	}
}

const (
	biRGB            = 0
	dibRGBColors     = 0
	srccopy          = 0x00CC0020
	maxDesktopWidth  = 1920
	maxDesktopHeight = 1080
	smCMonitors      = 80
	smXVIRTUALSCREEN = 76
	smYVIRTUALSCREEN = 77
	smCXVIRTUALSCREEN = 78
	smCYVIRTUALSCREEN = 79
)

type MonitorInfo struct {
	Index  int `json:"index"`
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
	Primary bool `json:"primary"`
}

func listMonitors() []MonitorInfo {
	count, _, _ := procGetSystemMetrics.Call(smCMonitors)
	n := int(count)
	if n < 1 {
		n = 1
	}
	monitors := make([]MonitorInfo, 0, n)
	// Simple virtual screen fallback for now; full EnumDisplayMonitors can be added later
	vx, _, _ := procGetSystemMetrics.Call(smXVIRTUALSCREEN)
	vy, _, _ := procGetSystemMetrics.Call(smYVIRTUALSCREEN)
	vw, _, _ := procGetSystemMetrics.Call(smCXVIRTUALSCREEN)
	vh, _, _ := procGetSystemMetrics.Call(smCYVIRTUALSCREEN)
	monitors = append(monitors, MonitorInfo{
		Index: 0, X: int(vx), Y: int(vy), Width: int(vw), Height: int(vh), Primary: true,
	})
	return monitors
}

func captureDesktopJPEG(monitorIndex int) ([]byte, int, int, error) {
	monitors := listMonitors()
	if monitorIndex < 0 || monitorIndex >= len(monitors) {
		monitorIndex = 0
	}
	mon := monitors[monitorIndex]
	width, height := mon.Width, mon.Height
	if width < 1 || height < 1 || width > 16384 || height > 16384 {
		return nil, 0, 0, errors.New("invalid desktop dimensions")
	}
	if int64(width)*int64(height) > 16_000_000 {
		return nil, 0, 0, errors.New("desktop exceeds the 16-megapixel capture limit")
	}
	screenDC, _, _ := procGetDC.Call(0)
	if screenDC == 0 {
		return nil, 0, 0, errors.New("GetDC failed")
	}
	defer procReleaseDC.Call(0, screenDC)
	memoryDC, _, _ := procCreateCompatibleDC.Call(screenDC)
	if memoryDC == 0 {
		return nil, 0, 0, errors.New("CreateCompatibleDC failed")
	}
	defer procDeleteDC.Call(memoryDC)
	bitmap, _, _ := procCreateCompatibleBitmap.Call(screenDC, uintptr(width), uintptr(height))
	if bitmap == 0 {
		return nil, 0, 0, errors.New("CreateCompatibleBitmap failed")
	}
	defer procDeleteObject.Call(bitmap)
	oldObject, _, _ := procSelectObject.Call(memoryDC, bitmap)
	if oldObject == 0 {
		return nil, 0, 0, errors.New("SelectObject failed")
	}
	defer procSelectObject.Call(memoryDC, oldObject)
	ok, _, _ := procBitBlt.Call(memoryDC, 0, 0, uintptr(width), uintptr(height), screenDC, uintptr(mon.X), uintptr(mon.Y), srccopy)
	if ok == 0 {
		return nil, 0, 0, errors.New("BitBlt failed")
	}

	pixels := make([]byte, width*height*4)
	info := bitmapInfo{Header: bitmapInfoHeader{
		Size:  uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		Width: int32(width), Height: -int32(height), Planes: 1, BitCount: 32,
		Compression: biRGB, SizeImage: uint32(len(pixels)),
	}}
	lines, _, _ := procGetDIBits.Call(
		memoryDC, bitmap, 0, uintptr(height),
		uintptr(unsafe.Pointer(&pixels[0])),
		uintptr(unsafe.Pointer(&info)), dibRGBColors,
	)
	if lines == 0 {
		return nil, 0, 0, errors.New("GetDIBits failed")
	}

	source := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := 0; i < len(pixels); i += 4 {
		source.Pix[i] = pixels[i+2]
		source.Pix[i+1] = pixels[i+1]
		source.Pix[i+2] = pixels[i]
		source.Pix[i+3] = 255
	}
	outWidth, outHeight := width, height
	scale := math.Min(1, math.Min(float64(maxDesktopWidth)/float64(width), float64(maxDesktopHeight)/float64(height)))
	if scale < 1 {
		outWidth = int(math.Max(1, math.Round(float64(width)*scale)))
		outHeight = int(math.Max(1, math.Round(float64(height)*scale)))
	}
	target := image.NewRGBA(image.Rect(0, 0, outWidth, outHeight))
	for y := 0; y < outHeight; y++ {
		sourceY := y * height / outHeight
		for x := 0; x < outWidth; x++ {
			sourceX := x * width / outWidth
			target.Set(x, y, source.At(sourceX, sourceY))
		}
	}
	var output bytes.Buffer
	if err := jpeg.Encode(&output, target, &jpeg.Options{Quality: 78}); err != nil {
		return nil, 0, 0, err
	}
	return output.Bytes(), outWidth, outHeight, nil
}

func applyDesktopInput(input DesktopInput) error {
	bitmap, _, _ := procCreateCompatibleBitmap.Call(screenDC, uintptr(width), uintptr(height))
	if bitmap == 0 {
		return nil, 0, 0, errors.New("CreateCompatibleBitmap failed")
	}
	defer procDeleteObject.Call(bitmap)
	oldObject, _, _ := procSelectObject.Call(memoryDC, bitmap)
	if oldObject == 0 {
		return nil, 0, 0, errors.New("SelectObject failed")
	}
	defer procSelectObject.Call(memoryDC, oldObject)
	ok, _, _ := procBitBlt.Call(memoryDC, 0, 0, uintptr(width), uintptr(height), screenDC, 0, 0, srccopy)
	if ok == 0 {
		return nil, 0, 0, errors.New("BitBlt failed")
	}

	pixels := make([]byte, width*height*4)
	info := bitmapInfo{Header: bitmapInfoHeader{
		Size:  uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		Width: int32(width), Height: -int32(height), Planes: 1, BitCount: 32,
		Compression: biRGB, SizeImage: uint32(len(pixels)),
	}}
	lines, _, _ := procGetDIBits.Call(
		memoryDC, bitmap, 0, uintptr(height),
		uintptr(unsafe.Pointer(&pixels[0])),
		uintptr(unsafe.Pointer(&info)), dibRGBColors,
	)
	if lines == 0 {
		return nil, 0, 0, errors.New("GetDIBits failed")
	}

	source := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := 0; i < len(pixels); i += 4 {
		source.Pix[i] = pixels[i+2]
		source.Pix[i+1] = pixels[i+1]
		source.Pix[i+2] = pixels[i]
		source.Pix[i+3] = 255
	}
	outWidth, outHeight := width, height
	scale := math.Min(1, math.Min(float64(maxDesktopWidth)/float64(width), float64(maxDesktopHeight)/float64(height)))
	if scale < 1 {
		outWidth = int(math.Max(1, math.Round(float64(width)*scale)))
		outHeight = int(math.Max(1, math.Round(float64(height)*scale)))
	}
	target := image.NewRGBA(image.Rect(0, 0, outWidth, outHeight))
	for y := 0; y < outHeight; y++ {
		sourceY := y * height / outHeight
		for x := 0; x < outWidth; x++ {
			sourceX := x * width / outWidth
			target.Set(x, y, source.At(sourceX, sourceY))
		}
	}
	var output bytes.Buffer
	if err := jpeg.Encode(&output, target, &jpeg.Options{Quality: 72}); err != nil {
		return nil, 0, 0, err
	}
	return output.Bytes(), outWidth, outHeight, nil
}

func applyDesktopInput(input DesktopInput) error {
	switch input.Event {
	case "pointer":
		if math.IsNaN(input.X) || math.IsNaN(input.Y) || input.X < 0 || input.X > 1 || input.Y < 0 || input.Y > 1 {
			return errors.New("pointer coordinates are out of range")
		}
		width, _, _ := procGetSystemMetrics.Call(0)
		height, _, _ := procGetSystemMetrics.Call(1)
		x := int32(math.Round(input.X * float64(maxInt(1, int(width)-1))))
		y := int32(math.Round(input.Y * float64(maxInt(1, int(height)-1))))
		if result, _, _ := procSetCursorPos.Call(uintptr(x), uintptr(y)); result == 0 {
			return errors.New("SetCursorPos failed")
		}
		flags := uintptr(0)
		if input.Kind == "down" || input.Kind == "up" {
			switch input.Button {
			case "left":
				if input.Kind == "down" {
					flags |= 0x0002
				} else {
					flags |= 0x0004
				}
			case "right":
				if input.Kind == "down" {
					flags |= 0x0008
				} else {
					flags |= 0x0010
				}
			case "middle":
				if input.Kind == "down" {
					flags |= 0x0020
				} else {
					flags |= 0x0040
				}
			default:
				return errors.New("unsupported mouse button")
			}
		}
		if flags != 0 {
			procMouseEvent.Call(flags, 0, 0, 0, 0)
		}
		return nil
	case "key":
		key, ok := virtualKey(input.Key)
		if !ok {
			return errors.New("unsupported keyboard key")
		}
		flags := uintptr(0)
		if !input.Down {
			flags = 0x0002 // KEYEVENTF_KEYUP
		}
		procKeybdEvent.Call(uintptr(key), 0, flags, 0)
		return nil
	default:
		return errors.New("unsupported desktop input event")
	}
}

func maxInt(minimum, value int) int {
	if value < minimum {
		return minimum
	}
	return value
}

func virtualKey(key string) (uint8, bool) {
	if len(key) == 4 && strings.HasPrefix(key, "Key") && key[3] >= 'A' && key[3] <= 'Z' {
		return key[3], true
	}
	if len(key) == 6 && strings.HasPrefix(key, "Digit") && key[5] >= '0' && key[5] <= '9' {
		return key[5], true
	}
	if len(key) == 7 && strings.HasPrefix(key, "Numpad") && key[6] >= '0' && key[6] <= '9' {
		return key[6], true
	}
	keys := map[string]uint8{
		"Enter": 0x0D, "Escape": 0x1B, "Backspace": 0x08, "Tab": 0x09, "Space": 0x20,
		"ArrowLeft": 0x25, "ArrowUp": 0x26, "ArrowRight": 0x27, "ArrowDown": 0x28,
		"Delete": 0x2E, "Home": 0x24, "End": 0x23, "PageUp": 0x21, "PageDown": 0x22,
		"ShiftLeft": 0xA0, "ShiftRight": 0xA1, "ControlLeft": 0xA2, "ControlRight": 0xA3,
		"AltLeft": 0xA4, "AltRight": 0xA5, "MetaLeft": 0x5B, "MetaRight": 0x5C,
		"F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73, "F5": 0x74, "F6": 0x75,
		"F7": 0x76, "F8": 0x77, "F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B,
		"Minus": 0xBD, "Equal": 0xBB, "BracketLeft": 0xDB, "BracketRight": 0xDD,
		"Backslash": 0xDC, "Semicolon": 0xBA, "Quote": 0xDE, "Backquote": 0xC0,
		"Comma": 0xBC, "Period": 0xBE, "Slash": 0xBF,
	}
	value, ok := keys[key]
	return value, ok
}
