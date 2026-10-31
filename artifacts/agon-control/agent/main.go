// Agon Agent is a transparent, consent-based endpoint agent.
// It intentionally exposes only allowlisted inventory and diagnostic actions.
package main

import (
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"crypto/tls"
	"encoding/base32"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const agentVersion = "1.0.3"

type Config struct {
	ServerURL        string `json:"serverUrl"`
	OwnerID          string `json:"ownerId"`
	DeviceID         string `json:"deviceId,omitempty"`
	DeviceToken      string `json:"deviceToken,omitempty"`
	PairingCode      string `json:"pairingCode,omitempty"`
	PairingRequested bool   `json:"pairingRequested,omitempty"`
	DeviceName       string `json:"deviceName"`
	Group            string `json:"group"`
	AllowUnattended  bool   `json:"allowUnattended"`
}

type DeviceInfo struct {
	DeviceID         string   `json:"deviceId,omitempty"`
	Hostname         string   `json:"hostname"`
	Name             string   `json:"name"`
	Group            string   `json:"group"`
	OS               string   `json:"os"`
	OSVersion        string   `json:"osVersion,omitempty"`
	Arch             string   `json:"arch"`
	Agent            string   `json:"agent"`
	CPUs             int      `json:"cpus"`
	CPUModel         string   `json:"cpuModel,omitempty"`
	Interfaces       int      `json:"interfaces"`
	IPAddresses      []string `json:"ipAddresses,omitempty"`
	MemoryTotalBytes uint64   `json:"memoryTotalBytes,omitempty"`
	MemoryUsedBytes  uint64   `json:"memoryUsedBytes,omitempty"`
	DiskTotalBytes   uint64   `json:"diskTotalBytes,omitempty"`
	DiskUsedBytes    uint64   `json:"diskUsedBytes,omitempty"`
	BootID           string   `json:"bootId"`
}

type DesktopInput struct {
	Event  string  `json:"event"`
	Kind   string  `json:"kind"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Button string  `json:"button"`
	Key    string  `json:"key"`
	Down   bool    `json:"down"`
}

type Envelope struct {
	Type      string          `json:"type"`
	JobID     string          `json:"jobId,omitempty"`
	Action    string          `json:"action,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
	Device    *DeviceInfo     `json:"device,omitempty"`
	Result    any             `json:"result,omitempty"`
	Error     string          `json:"error,omitempty"`
	JPEG      string          `json:"jpeg,omitempty"`
	Width     int             `json:"width,omitempty"`
	Height    int             `json:"height,omitempty"`
	SentAt    time.Time       `json:"sentAt"`
}

type socketClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *socketClient) send(message Envelope) error {
	message.SentAt = time.Now().UTC()
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return c.conn.WriteJSON(message)
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	configPath := flag.String("config", "agent.json", "path to agent configuration")
	server := flag.String("server", "", "control plane URL, for example https://relay.example.com")
	name := flag.String("name", "", "display name (defaults to hostname)")
	group := flag.String("group", "", "device group (defaults to the configuration or Unassigned)")
	allowUnattended := flag.Bool("allow-unattended", false, "opt this endpoint into organization-policy-approved unattended support")
	pair := flag.Bool("pair", false, "create device identity and request operator approval")
	install := flag.Bool("install", false, "install as a visible operating system service")
	uninstall := flag.Bool("uninstall", false, "stop and remove the operating system service")
	companion := flag.Bool("companion", false, "run the visible user-session desktop companion")
	consent := flag.Bool("consent", false, "confirm that you own or administer this device and consent to installation")
	showVersion := flag.Bool("version", false, "print agent version")
	flag.Parse()

	if *showVersion {
		fmt.Printf("Agon Agent %s (%s/%s)\n", agentVersion, runtime.GOOS, runtime.GOARCH)
		return
	}
	if *uninstall {
		if !*consent {
			log.Fatal("uninstall requires -consent confirmation")
		}
		if err := uninstallPlatform(); err != nil {
			log.Fatal(err)
		}
		fmt.Println("Agon Agent service removed.")
		return
	}
	if *install {
		if !*consent {
			log.Fatal("installation requires -consent; silent or unauthorized installation is not supported")
		}
		if err := installPlatform(*configPath); err != nil {
			log.Fatal(err)
		}
		fmt.Println("Agon Agent installed and started. Management is visible in the operating system service manager.")
		return
	}

	cfg, err := loadConfig(*configPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Fatal(err)
	}
	if *server != "" {
		cfg.ServerURL = *server
	}
	if *name != "" {
		cfg.DeviceName = *name
	}
	if *group != "" {
		cfg.Group = *group
	}
	if *allowUnattended {
		cfg.AllowUnattended = true
	}
	if cfg.DeviceName == "" {
		cfg.DeviceName, _ = os.Hostname()
	}
	if cfg.Group == "" {
		cfg.Group = "Unassigned"
	}

	if *companion {
		if cfg.DeviceID == "" || cfg.DeviceToken == "" {
			fmt.Println("Agon Desktop Companion is waiting for the installed service to create this device identity.")
			for attempt := 0; attempt < 30; attempt++ {
				time.Sleep(time.Second)
				latest, loadErr := loadConfig(*configPath)
				if loadErr == nil {
					cfg = latest
				}
				if cfg.DeviceID != "" && cfg.DeviceToken != "" {
					break
				}
			}
			if cfg.DeviceID == "" || cfg.DeviceToken == "" {
				log.Fatal("device identity is not available; confirm that the AgonAgent service is installed and running")
			}
		}
		log.Printf("Agon visible desktop companion starting for %s; close this window to disconnect", cfg.DeviceName)
		if cfg.PairingCode != "" {
			fmt.Printf("Pairing code: %s\nApprove this device in the Agon Control deployment page.\n", formatPairingCode(cfg.PairingCode))
		}
		if err := runAgentChannel(context.Background(), cfg, *configPath, "companion"); err != nil {
			log.Fatal(err)
		}
		return
	}
	if *pair {
		if _, err := requestPairing(&cfg, *configPath); err != nil {
			log.Fatal(err)
		}
		return
	}
	if handled, err := maybeRunPlatformService(*configPath, cfg); handled {
		if err != nil {
			log.Fatal(err)
		}
		return
	}
	if cfg.ServerURL == "" {
		log.Fatal("server URL is required; use -server https://relay.example.com or provide agent.json")
	}
	log.Printf("Agon Agent %s starting for %s; outbound control plane: %s", agentVersion, cfg.DeviceName, cfg.ServerURL)
	if err := runAgent(context.Background(), cfg, *configPath); err != nil {
		log.Fatal(err)
	}
}

func loadConfig(path string) (Config, error) {
	var cfg Config
	data, err := os.ReadFile(path)
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("invalid config: %w", err)
	}
	return cfg, nil
}

func saveConfig(path string, cfg Config) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil && filepath.Dir(path) != "." {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func currentDeviceInfo(cfg Config) DeviceInfo {
	hostname, _ := os.Hostname()
	interfaces, _ := net.Interfaces()
	inventory := collectDeviceInventory()
	return DeviceInfo{
		DeviceID: cfg.DeviceID, Hostname: hostname, Name: cfg.DeviceName, Group: cfg.Group,
		OS: runtime.GOOS, OSVersion: inventory.OSVersion, Arch: runtime.GOARCH,
		Agent: agentVersion, CPUs: runtime.NumCPU(), CPUModel: inventory.CPUModel,
		Interfaces: len(interfaces), IPAddresses: inventory.IPAddresses,
		MemoryTotalBytes: inventory.MemoryTotalBytes, MemoryUsedBytes: inventory.MemoryUsedBytes,
		DiskTotalBytes: inventory.DiskTotalBytes, DiskUsedBytes: inventory.DiskUsedBytes,
		BootID: fmt.Sprintf("%d", time.Now().Unix()),
	}
}

func validateServer(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if u.Scheme != "https" && u.Scheme != "http" && u.Scheme != "wss" && u.Scheme != "ws" {
		return fmt.Errorf("unsupported server scheme %q", u.Scheme)
	}
	if (u.Scheme == "http" || u.Scheme == "ws") && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" {
		return errors.New("plaintext connections are allowed only for local development; use HTTPS/WSS")
	}
	return nil
}

func ensureDeviceIdentity(cfg *Config) error {
	if cfg.DeviceID != "" && cfg.DeviceToken != "" && cfg.PairingCode != "" {
		return nil
	}
	if cfg.DeviceID == "" {
		id := make([]byte, 16)
		if _, err := cryptorand.Read(id); err != nil {
			return fmt.Errorf("generate device identity: %w", err)
		}
		id[6] = (id[6] & 0x0f) | 0x40
		id[8] = (id[8] & 0x3f) | 0x80
		cfg.DeviceID = fmt.Sprintf("%x-%x-%x-%x-%x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16])
	}
	if cfg.DeviceToken == "" {
		token := make([]byte, 32)
		if _, err := cryptorand.Read(token); err != nil {
			return fmt.Errorf("generate device credential: %w", err)
		}
		cfg.DeviceToken = base64.RawURLEncoding.EncodeToString(token)
	}
	if cfg.PairingCode == "" {
		raw := make([]byte, 10)
		if _, err := cryptorand.Read(raw); err != nil {
			return fmt.Errorf("generate pairing code: %w", err)
		}
		cfg.PairingCode = base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	}
	return nil
}

func hostedControlPlane(serverURL string) bool {
	u, err := url.Parse(serverURL)
	return err == nil && strings.HasSuffix(strings.TrimRight(u.Path, "/"), "/api/agon")
}

func formatPairingCode(code string) string {
	if len(code) != 16 {
		return code
	}
	return strings.Join([]string{code[:4], code[4:8], code[8:12], code[12:]}, "-")
}

func setNativeRequestHeaders(req *http.Request, serverURL string) error {
	u, err := url.Parse(serverURL)
	if err != nil {
		return err
	}
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	if hostedControlPlane(serverURL) {
		origin := u.Scheme + "://" + u.Host
		req.Header.Set("Origin", origin)
		req.Header.Set("Referer", origin+"/deployment")
	}
	return nil
}

func requestPairing(cfg *Config, configPath string) (string, error) {
	if err := ensureDeviceIdentity(cfg); err != nil {
		return "", err
	}
	if cfg.OwnerID == "" && hostedControlPlane(cfg.ServerURL) {
		return "", errors.New("ownerId is missing from agent.json; build the installer from the signed-in Agon console")
	}
	if err := saveConfig(configPath, *cfg); err != nil {
		return "", fmt.Errorf("save device identity: %w", err)
	}
	if err := validateServer(cfg.ServerURL); err != nil {
		return "", err
	}
	base := strings.TrimRight(cfg.ServerURL, "/")
	base = strings.Replace(base, "wss://", "https://", 1)
	base = strings.Replace(base, "ws://", "http://", 1)
	payload, _ := json.Marshal(map[string]any{
		"ownerId":         cfg.OwnerID,
		"deviceId":        cfg.DeviceID,
		"deviceToken":     cfg.DeviceToken,
		"pairingCode":     cfg.PairingCode,
		"allowUnattended": cfg.AllowUnattended,
		"device":          currentDeviceInfo(*cfg),
	})
	req, err := http.NewRequest(http.MethodPost, base+"/api/pair-requests", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if err := setNativeRequestHeaders(req, cfg.ServerURL); err != nil {
		return "", err
	}
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return "", fmt.Errorf("device pairing request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return "", fmt.Errorf("device pairing request failed (%s): %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var result struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", err
	}
	if result.Status != "pending" && result.Status != "approved" {
		return "", errors.New("device pairing response was incomplete")
	}
	if result.Status == "approved" {
		cfg.PairingCode = ""
	}
	cfg.PairingRequested = true
	if err := saveConfig(configPath, *cfg); err != nil {
		return "", fmt.Errorf("save device identity: %w", err)
	}
	if result.Status == "pending" && cfg.PairingCode != "" {
		fmt.Printf("Device %s is waiting for operator approval.\nPairing code: %s\n", cfg.DeviceName, formatPairingCode(cfg.PairingCode))
	}
	return result.Status, nil
}

func runAgent(ctx context.Context, cfg Config, configPath string) error {
	return runAgentChannel(ctx, cfg, configPath, "agent")
}

func runAgentChannel(ctx context.Context, cfg Config, configPath, channel string) error {
	if err := validateServer(cfg.ServerURL); err != nil {
		return err
	}
	backoff := time.Second
	for {
		connectionStarted := time.Time{}
		newIdentity := cfg.DeviceID == "" || cfg.DeviceToken == ""
		if channel == "companion" && newIdentity {
			return errors.New("desktop companion requires an installed device identity")
		}
		if cfg.DeviceID == "" || cfg.DeviceToken == "" {
			if err := ensureDeviceIdentity(&cfg); err != nil {
				return err
			}
		}
		if channel == "agent" && !cfg.PairingRequested && (newIdentity || cfg.OwnerID != "") {
			if _, err := requestPairing(&cfg, configPath); err != nil {
				log.Printf("device pairing: %v", err)
				goto retry
			}
		}
		{
			connectionStarted = time.Now()
			err := runConnection(ctx, &cfg, configPath, channel)
			if ctx.Err() != nil {
				return nil
			}
			if errors.Is(err, errAwaitingApproval) {
				log.Printf("relay: waiting for an operator to approve device %s", cfg.DeviceID)
			} else if err != nil {
				log.Printf("connection: %v", err)
			}
			if time.Since(connectionStarted) >= 30*time.Second {
				backoff = time.Second
			}
		}
	retry:
		retryDelay := backoff
		if backoff > time.Second {
			retryDelay += time.Duration(rand.Int63n(int64(backoff / 4)))
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(retryDelay):
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

var errAwaitingApproval = errors.New("device is waiting for operator approval")

func runConnection(ctx context.Context, cfg *Config, configPath, channel string) error {
	if err := validateServer(cfg.ServerURL); err != nil {
		return err
	}
	u, err := url.Parse(strings.TrimRight(cfg.ServerURL, "/"))
	if err != nil {
		return err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	case "wss", "ws":
	default:
		return errors.New("invalid websocket scheme")
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/agent"
	q := u.Query()
	q.Set("deviceId", cfg.DeviceID)
	q.Set("channel", channel)
	u.RawQuery = q.Encode()
	dialer := websocket.Dialer{HandshakeTimeout: 15 * time.Second, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+cfg.DeviceToken)
	if err := setNativeRequestHeaders(&http.Request{Header: headers}, cfg.ServerURL); err != nil {
		return err
	}
	conn, handshake, err := dialer.DialContext(ctx, u.String(), headers)
	if err != nil {
		if handshake != nil && handshake.StatusCode == http.StatusUnauthorized {
			return errAwaitingApproval
		}
		return err
	}
	defer conn.Close()
	conn.SetReadLimit(1_500_000)
	const pongWait = 70 * time.Second
	if err := conn.SetReadDeadline(time.Now().Add(pongWait)); err != nil {
		return err
	}
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	client := &socketClient{conn: conn}
	if channel == "agent" {
		info := currentDeviceInfo(*cfg)
		if err := client.send(Envelope{Type: "hello", Device: &info}); err != nil {
			return err
		}
	}
	if cfg.PairingCode != "" {
		cfg.PairingCode = ""
		if err := saveConfig(configPath, *cfg); err != nil {
			log.Printf("could not clear pairing code from config: %v", err)
		}
	}
	log.Printf("connected to relay; device=%s channel=%s", cfg.DeviceID, channel)

	connectionCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		<-connectionCtx.Done()
		_ = conn.Close()
	}()
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-connectionCtx.Done():
				return
			case <-ticker.C:
				var heartbeat Envelope
				if channel == "agent" {
					current := currentDeviceInfo(*cfg)
					heartbeat = Envelope{Type: "heartbeat", Device: &current}
				} else {
					heartbeat = Envelope{Type: "heartbeat"}
				}
				if err := client.send(heartbeat); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	var desktopMu sync.Mutex
	var activeDesktopSession string
	var stopDesktop context.CancelFunc
	var pauseDesktop chan bool
	var consentMu sync.Mutex
	var pendingConsentSession string
	defer func() {
		consentMu.Lock()
		pendingConsentSession = ""
		consentMu.Unlock()
		cancelDesktopConsent()
		desktopMu.Lock()
		if stopDesktop != nil {
			stopDesktop()
		}
		desktopMu.Unlock()
	}()
	startDesktop := func(sessionID string, unattended bool) {
		desktopMu.Lock()
		if stopDesktop != nil {
			stopDesktop()
		}
		sessionCtx, stop := context.WithCancel(connectionCtx)
		stopDesktop = stop
		activeDesktopSession = sessionID
		pauseDesktop = make(chan bool, 1)
		pauseDesktop <- true
		pauseSignal := pauseDesktop
		desktopMu.Unlock()
		go streamDesktopSession(sessionCtx, client, sessionID, pauseSignal)
		if unattended {
			log.Printf("organization-authorized unattended desktop session is active: session %s", sessionID)
			log.Printf("*** UNATTENDED DESKTOP ACCESS ACTIVE: session %s; close this visible companion window to disconnect. ***", sessionID)
		} else {
			log.Printf("local user approved interactive support session %s", sessionID)
			log.Printf("*** DESKTOP SHARING ACTIVE: session %s; close this visible companion window to disconnect. ***", sessionID)
		}
	}
	for {
		var message Envelope
		if err := conn.ReadJSON(&message); err != nil {
			return err
		}
		if message.Type == "command" {
			if channel == "companion" && message.Action == "session.request" {
				var request struct {
					SessionID  string `json:"sessionId"`
					Code       string `json:"code"`
					Customer   string `json:"customer"`
					Issue      string `json:"issue"`
					Technician string `json:"technician"`
					Mode       string `json:"mode"`
				}
				if err := json.Unmarshal(message.Payload, &request); err != nil || request.SessionID == "" {
					_ = client.send(Envelope{Type: "command_result", JobID: message.JobID, Action: message.Action, Error: "Invalid desktop session request"})
					continue
				}
				if request.Mode == "unattended" {
					if !cfg.AllowUnattended {
						_ = client.send(Envelope{
							Type:   "command_result",
							JobID:  message.JobID,
							Action: message.Action,
							Error:  "This endpoint was not explicitly opted in for unattended desktop access during installation.",
						})
						log.Printf("unattended desktop request rejected; endpoint installation opt-in is disabled")
						continue
					}
					consentMu.Lock()
					hasPendingConsent := pendingConsentSession != ""
					consentMu.Unlock()
					desktopMu.Lock()
					hasOtherActiveSession := activeDesktopSession != "" && activeDesktopSession != request.SessionID
					desktopMu.Unlock()
					if hasPendingConsent || hasOtherActiveSession {
						_ = client.send(Envelope{
							Type:   "command_result",
							JobID:  message.JobID,
							Action: message.Action,
							Error:  "Another desktop session is already active on this endpoint.",
						})
						continue
					}
					if err := client.send(Envelope{
						Type:   "command_result",
						JobID:  message.JobID,
						Action: message.Action,
						Result: map[string]any{"accepted": true, "unattended": true},
					}); err != nil {
						return err
					}
					log.Printf("unattended session request from %s: %s", request.Technician, request.Issue)
					startDesktop(request.SessionID, true)
					continue
				}
				if request.Mode != "" && request.Mode != "interactive" {
					_ = client.send(Envelope{Type: "command_result", JobID: message.JobID, Action: message.Action, Error: "Unsupported desktop access mode"})
					continue
				}
				consentMu.Lock()
				if pendingConsentSession != "" {
					consentMu.Unlock()
					_ = client.send(Envelope{Type: "command_result", JobID: message.JobID, Action: message.Action, Error: "Another local consent prompt is already open"})
					continue
				}
				pendingConsentSession = request.SessionID
				consentMu.Unlock()
				go func() {
					accepted, consentErr := confirmDesktopConsent(request.Customer, request.Technician, request.Issue, request.Code)
					consentMu.Lock()
					stillPending := pendingConsentSession == request.SessionID
					if stillPending {
						pendingConsentSession = ""
					}
					consentMu.Unlock()
					if !stillPending || connectionCtx.Err() != nil {
						return
					}
					result := map[string]any{"accepted": accepted}
					if !accepted && consentErr == nil {
						result["declined"] = true
					}
					response := Envelope{Type: "command_result", JobID: message.JobID, Action: message.Action, Result: result}
					if consentErr != nil {
						response.Error = consentErr.Error()
					}
					if err := client.send(response); err != nil || !accepted {
						return
					}
					startDesktop(request.SessionID, false)
				}()
				continue
			}
			result, commandErr := executeAllowlisted(message.Action, *cfg)
			response := Envelope{Type: "command_result", JobID: message.JobID, Action: message.Action, Result: result}
			if commandErr != nil {
				response.Error = commandErr.Error()
			}
			if err := client.send(response); err != nil {
				return err
			}
		} else if channel == "companion" && message.Type == "session_stop" {
			consentMu.Lock()
			cancelConsent := message.SessionID == pendingConsentSession
			if message.SessionID == pendingConsentSession {
				pendingConsentSession = ""
			}
			consentMu.Unlock()
			if cancelConsent {
				cancelDesktopConsent()
			}
			desktopMu.Lock()
			if message.SessionID == activeDesktopSession {
				if stopDesktop != nil {
					stopDesktop()
				}
				stopDesktop = nil
				pauseDesktop = nil
				activeDesktopSession = ""
				log.Printf("desktop sharing ended for session %s", message.SessionID)
			}
			desktopMu.Unlock()
		} else if channel == "companion" && message.Type == "desktop_input" {
			desktopMu.Lock()
			isActive := message.SessionID != "" && message.SessionID == activeDesktopSession
			desktopMu.Unlock()
			if isActive {
				var input DesktopInput
				if err := json.Unmarshal(message.Payload, &input); err == nil {
					_ = applyDesktopInput(input)
				}
			}
		} else if channel == "companion" && (message.Type == "desktop_pause" || message.Type == "desktop_resume") {
			desktopMu.Lock()
			if message.SessionID == activeDesktopSession && pauseDesktop != nil {
				paused := message.Type == "desktop_pause"
				select {
				case pauseDesktop <- paused:
				default:
					select {
					case <-pauseDesktop:
					default:
					}
					pauseDesktop <- paused
				}
			}
			desktopMu.Unlock()
		}
	}
}

func streamDesktopSession(ctx context.Context, client *socketClient, sessionID string, pause <-chan bool) {
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	paused := true
	for {
		select {
		case <-ctx.Done():
			return
		case paused = <-pause:
		case <-ticker.C:
			if paused {
				continue
			}
			frame, width, height, err := captureDesktopJPEG()
			if err != nil {
				log.Printf("desktop capture: %v", err)
				continue
			}
			message := Envelope{
				Type: "desktop_frame", SessionID: sessionID,
				JPEG:  base64.StdEncoding.EncodeToString(frame),
				Width: width, Height: height,
			}
			if err := client.send(message); err != nil {
				return
			}
		}
	}
}

func executeAllowlisted(action string, cfg Config) (any, error) {
	switch action {
	case "agent.ping":
		return map[string]any{"reply": "pong", "agent": agentVersion, "time": time.Now().UTC()}, nil
	case "inventory.refresh":
		info := currentDeviceInfo(cfg)
		return info, nil
	case "diagnostics.network":
		interfaces, err := net.Interfaces()
		if err != nil {
			return nil, err
		}
		result := make([]map[string]any, 0, len(interfaces))
		for _, item := range interfaces {
			addresses, _ := item.Addrs()
			values := make([]string, 0, len(addresses))
			for _, address := range addresses {
				values = append(values, address.String())
			}
			result = append(result, map[string]any{"name": item.Name, "mtu": item.MTU, "up": item.Flags&net.FlagUp != 0, "addresses": values})
		}
		return result, nil
	case "session.request":
		if !cfg.AllowUnattended {
			return nil, errors.New("endpoint policy requires local interactive consent")
		}
		return map[string]any{"accepted": true, "mode": "unattended-policy", "notice": "diagnostic session authorized by installed endpoint policy"}, nil
	default:
		return nil, fmt.Errorf("action %q is not in the endpoint allowlist", action)
	}
}

func copyFile(source, destination string, mode os.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}

func prepareInstalledFiles(configPath, executableDir, settingsDir string) (string, string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", "", err
	}
	binaryName := "agon-agent"
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	installedExecutable := filepath.Join(executableDir, binaryName)
	if err := copyFile(executable, installedExecutable, 0755); err != nil {
		return "", "", err
	}
	installedConfig := filepath.Join(settingsDir, "agent.json")
	if err := copyFile(configPath, installedConfig, 0600); err != nil {
		return "", "", fmt.Errorf("copy configuration: %w", err)
	}
	return installedExecutable, installedConfig, nil
}
