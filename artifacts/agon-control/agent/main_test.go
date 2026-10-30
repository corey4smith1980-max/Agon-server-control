package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestPairRequestSendsNativeHeaders(t *testing.T) {
	headers := make(chan http.Header, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/deployment/api/agon/api/pair-requests" {
			t.Errorf("request path = %q, want /deployment/api/agon/api/pair-requests", r.URL.Path)
		}
		headers <- r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"status":"pending"}`))
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "agent.json")
	cfg := &Config{
		ServerURL:  server.URL + "/deployment/api/agon",
		OwnerID:    "user_test",
		DeviceName: "test-device",
	}

	status, err := requestPairing(cfg, configPath)
	if err != nil {
		t.Fatalf("pair request failed: %v", err)
	}
	if status != "pending" {
		t.Fatalf("pairing status = %q, want pending", status)
	}
	gotHeaders := <-headers
	if got := gotHeaders.Get("X-Requested-With"); got != "XMLHttpRequest" {
		t.Fatalf("X-Requested-With = %q, want %q", got, "XMLHttpRequest")
	}
	if got := gotHeaders.Get("Origin"); got != server.URL {
		t.Fatalf("Origin = %q, want %q", got, server.URL)
	}
	if got := gotHeaders.Get("Referer"); got != server.URL+"/deployment" {
		t.Fatalf("Referer = %q, want %q", got, server.URL+"/deployment")
	}
	if cfg.DeviceID == "" || cfg.DeviceToken == "" || len(cfg.PairingCode) != 16 {
		t.Fatal("pair request did not create a stable identity and pairing code")
	}
	if !cfg.PairingRequested {
		t.Fatal("successful pair request was not persisted")
	}
	saved, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read saved config: %v", err)
	}
	var savedConfig Config
	if err := json.Unmarshal(saved, &savedConfig); err != nil {
		t.Fatalf("parse saved config: %v", err)
	}
	if !savedConfig.PairingRequested || savedConfig.DeviceToken == "" {
		t.Fatal("device identity was not persisted")
	}
	var savedFields map[string]any
	if err := json.Unmarshal(saved, &savedFields); err != nil {
		t.Fatalf("parse saved config fields: %v", err)
	}
	if _, ok := savedFields["enrollmentToken"]; ok {
		t.Fatal("obsolete enrollment token field should not exist")
	}
}

func TestAgentWaitsForPairingApprovalThenConnects(t *testing.T) {
	var pairRequests atomic.Int32
	var connections atomic.Int32
	connected := make(chan struct{}, 1)
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/deployment/api/agon/api/pair-requests":
			pairRequests.Add(1)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"status":"pending"}`))
		case "/deployment/api/agon/agent":
			attempt := connections.Add(1)
			if attempt == 1 {
				http.Error(w, "operator approval required", http.StatusUnauthorized)
				return
			}
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer conn.Close()
			var hello Envelope
			if err := conn.ReadJSON(&hello); err != nil {
				t.Errorf("read agent hello: %v", err)
				return
			}
			if hello.Type != "hello" {
				t.Errorf("first message type = %q, want hello", hello.Type)
				return
			}
			connected <- struct{}{}
			_, _, _ = conn.ReadMessage()
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "agent.json")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	cfg := Config{
		ServerURL:  server.URL + "/deployment/api/agon",
		OwnerID:    "user_test",
		DeviceName: "pair-test",
		Group:      "Unassigned",
	}
	go func() {
		result <- runAgent(ctx, cfg, configPath)
	}()

	select {
	case <-connected:
		cancel()
	case <-time.After(6 * time.Second):
		cancel()
		t.Fatal("agent did not connect after operator approval")
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("runAgent returned after cancellation: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("agent did not stop after cancellation")
	}
	if got := pairRequests.Load(); got != 1 {
		t.Fatalf("pair requests = %d, want exactly one", got)
	}
	if got := connections.Load(); got < 2 {
		t.Fatalf("WebSocket connections = %d, want an initial denial and approved connection", got)
	}

	saved, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read paired config: %v", err)
	}
	var savedConfig Config
	if err := json.Unmarshal(saved, &savedConfig); err != nil {
		t.Fatalf("parse paired config: %v", err)
	}
	if savedConfig.PairingCode != "" || !savedConfig.PairingRequested {
		t.Fatal("successful relay connection should clear the local pairing code and retain pairing state")
	}
}

func TestRunAgentReconnectsAfterAbruptSocketDrop(t *testing.T) {
	var connections atomic.Int32
	reconnected := make(chan struct{}, 1)
	upgrader := websocket.Upgrader{
		CheckOrigin: func(*http.Request) bool { return true },
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/deployment/api/agon/agent" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("deviceId") != "device-test" {
			t.Errorf("deviceId = %q, want device-test", r.URL.Query().Get("deviceId"))
			http.Error(w, "invalid device", http.StatusUnauthorized)
			return
		}
		if r.Header.Get("Authorization") != "Bearer device-secret" {
			t.Errorf("agent authorization header was not sent")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		var hello Envelope
		if err := conn.ReadJSON(&hello); err != nil {
			return
		}
		if hello.Type != "hello" {
			t.Errorf("first message type = %q, want hello", hello.Type)
			return
		}

		attempt := connections.Add(1)
		if attempt == 1 {
			// Close the underlying TCP connection without a WebSocket close
			// frame to simulate a network interruption.
			_ = conn.UnderlyingConn().Close()
			return
		}
		if attempt == 2 {
			reconnected <- struct{}{}
			_, _, _ = conn.ReadMessage()
		}
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	cfg := Config{
		ServerURL:   server.URL + "/deployment/api/agon",
		DeviceID:    "device-test",
		DeviceToken: "device-secret",
		DeviceName:  "test-device",
	}
	go func() {
		result <- runAgent(ctx, cfg, "")
	}()

	select {
	case <-reconnected:
		cancel()
	case <-time.After(6 * time.Second):
		cancel()
		t.Fatal("agent did not reconnect after the socket dropped")
	}

	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("runAgent returned an error after cancellation: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("runAgent did not stop after cancellation")
	}

	if got := connections.Load(); got < 2 {
		t.Fatalf("WebSocket connections = %d, want at least 2", got)
	}
}
