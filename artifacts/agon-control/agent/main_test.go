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

func TestEnrollSendsRequestedWithHeader(t *testing.T) {
	requestHeader := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestHeader <- r.Header.Get("X-Requested-With")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"deviceId":"device-test","deviceToken":"device-secret"}`))
	}))
	defer server.Close()

	configPath := filepath.Join(t.TempDir(), "agent.json")
	cfg := &Config{
		ServerURL:       server.URL,
		EnrollmentToken: "bootstrap-token",
		DeviceName:      "test-device",
	}

	if err := enroll(cfg, configPath); err != nil {
		t.Fatalf("enroll failed: %v", err)
	}
	if got := <-requestHeader; got != "XMLHttpRequest" {
		t.Fatalf("X-Requested-With = %q, want %q", got, "XMLHttpRequest")
	}
	if cfg.EnrollmentToken != "" {
		t.Fatal("bootstrap enrollment token should be cleared after enrollment")
	}

	saved, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read saved config: %v", err)
	}
	var savedConfig Config
	if err := json.Unmarshal(saved, &savedConfig); err != nil {
		t.Fatalf("parse saved config: %v", err)
	}
	if savedConfig.EnrollmentToken != "" {
		t.Fatal("bootstrap enrollment token was persisted")
	}
}

func TestRunAgentReconnectsAfterAbruptSocketDrop(t *testing.T) {
	var connections atomic.Int32
	reconnected := make(chan struct{}, 1)
	upgrader := websocket.Upgrader{
		CheckOrigin: func(*http.Request) bool { return true },
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agon/agent" {
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
		ServerURL:   server.URL + "/api/agon",
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
