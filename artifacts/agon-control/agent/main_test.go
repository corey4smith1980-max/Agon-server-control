package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
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
