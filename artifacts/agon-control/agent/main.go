// Agon Agent is a transparent, consent-based endpoint agent.
// It intentionally exposes only allowlisted inventory and diagnostic actions.
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
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

const agentVersion = "1.0.0"

type Config struct {
	ServerURL       string `json:"serverUrl"`
	EnrollmentToken string `json:"enrollmentToken,omitempty"`
	DeviceID        string `json:"deviceId,omitempty"`
	DeviceToken     string `json:"deviceToken,omitempty"`
	DeviceName      string `json:"deviceName"`
	Group           string `json:"group"`
	AllowUnattended bool   `json:"allowUnattended"`
}

type DeviceInfo struct {
	DeviceID   string `json:"deviceId,omitempty"`
	Hostname   string `json:"hostname"`
	Name       string `json:"name"`
	Group      string `json:"group"`
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	Agent      string `json:"agent"`
	CPUs       int    `json:"cpus"`
	Interfaces int    `json:"interfaces"`
	BootID     string `json:"bootId"`
}

type Envelope struct {
	Type    string          `json:"type"`
	JobID   string          `json:"jobId,omitempty"`
	Action  string          `json:"action,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Device  *DeviceInfo     `json:"device,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   string          `json:"error,omitempty"`
	SentAt  time.Time       `json:"sentAt"`
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
	enrollmentToken := flag.String("enrollment-token", "", "one-time or site enrollment token")
	name := flag.String("name", "", "display name (defaults to hostname)")
	group := flag.String("group", "", "device group (defaults to the configuration or Unassigned)")
	allowUnattended := flag.Bool("allow-unattended", false, "allow administrator-approved unattended diagnostic jobs")
	install := flag.Bool("install", false, "install as a visible operating system service")
	uninstall := flag.Bool("uninstall", false, "stop and remove the operating system service")
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
	if *enrollmentToken != "" {
		cfg.EnrollmentToken = *enrollmentToken
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
	return DeviceInfo{
		DeviceID: cfg.DeviceID, Hostname: hostname, Name: cfg.DeviceName, Group: cfg.Group,
		OS: runtime.GOOS, Arch: runtime.GOARCH, Agent: agentVersion, CPUs: runtime.NumCPU(),
		Interfaces: len(interfaces), BootID: fmt.Sprintf("%d", time.Now().Unix()),
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

func enroll(cfg *Config, configPath string) error {
	if cfg.DeviceID != "" && cfg.DeviceToken != "" {
		return nil
	}
	if cfg.EnrollmentToken == "" {
		return errors.New("device is not enrolled and enrollmentToken is missing")
	}
	if err := validateServer(cfg.ServerURL); err != nil {
		return err
	}
	base := strings.TrimRight(cfg.ServerURL, "/")
	base = strings.Replace(base, "wss://", "https://", 1)
	base = strings.Replace(base, "ws://", "http://", 1)
	payload, _ := json.Marshal(map[string]any{"enrollmentToken": cfg.EnrollmentToken, "device": currentDeviceInfo(*cfg)})
	req, err := http.NewRequest(http.MethodPost, base+"/api/enroll", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	resp, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("enrollment request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("enrollment failed (%s): %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var result struct {
		DeviceID    string `json:"deviceId"`
		DeviceToken string `json:"deviceToken"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return err
	}
	if result.DeviceID == "" || result.DeviceToken == "" {
		return errors.New("enrollment response was incomplete")
	}
	cfg.DeviceID, cfg.DeviceToken = result.DeviceID, result.DeviceToken
	cfg.EnrollmentToken = ""
	if err := saveConfig(configPath, *cfg); err != nil {
		return fmt.Errorf("save device credentials: %w", err)
	}
	log.Printf("enrolled as device %s", cfg.DeviceID)
	return nil
}

func runAgent(ctx context.Context, cfg Config, configPath string) error {
	if err := validateServer(cfg.ServerURL); err != nil {
		return err
	}
	backoff := time.Second
	for {
		if err := enroll(&cfg, configPath); err != nil {
			log.Printf("enrollment: %v", err)
		} else {
			err := runConnection(ctx, cfg)
			if ctx.Err() != nil {
				return nil
			}
			if err != nil {
				log.Printf("connection: %v", err)
			}
			backoff = time.Second
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

func runConnection(ctx context.Context, cfg Config) error {
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
	u.RawQuery = q.Encode()
	dialer := websocket.Dialer{HandshakeTimeout: 15 * time.Second, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+cfg.DeviceToken)
	conn, _, err := dialer.DialContext(ctx, u.String(), headers)
	if err != nil {
		return err
	}
	defer conn.Close()
	client := &socketClient{conn: conn}
	info := currentDeviceInfo(cfg)
	if err := client.send(Envelope{Type: "hello", Device: &info}); err != nil {
		return err
	}
	log.Printf("connected to relay; device=%s", cfg.DeviceID)

	connectionCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-connectionCtx.Done():
				return
			case <-ticker.C:
				current := currentDeviceInfo(cfg)
				if err := client.send(Envelope{Type: "heartbeat", Device: &current}); err != nil {
					cancel()
					return
				}
			}
		}
	}()

	for {
		var message Envelope
		if err := conn.ReadJSON(&message); err != nil {
			return err
		}
		if message.Type == "command" {
			result, commandErr := executeAllowlisted(message.Action, cfg)
			response := Envelope{Type: "command_result", JobID: message.JobID, Action: message.Action, Result: result}
			if commandErr != nil {
				response.Error = commandErr.Error()
			}
			if err := client.send(response); err != nil {
				return err
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
