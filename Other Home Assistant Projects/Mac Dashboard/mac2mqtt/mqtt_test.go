package main

import (
	"encoding/pem"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

func TestBrokerTLS(t *testing.T) {
	server := httptest.NewTLSServer(nil)
	defer server.Close()
	file := filepath.Join(t.TempDir(), "broker.pem")
	if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, host, file string
		valid            bool
	}{
		{"trusted", "127.0.0.1", file, true}, {"untrusted", "127.0.0.1", "", false}, {"hostname mismatch", "wrong.invalid", file, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			opts, err := brokerOptions(config{Ip: tc.host, Port: "8883", TLS: true, CAFile: tc.file})
			if err != nil {
				t.Fatal(err)
			}
			if opts.Servers[0].Scheme != "ssl" {
				t.Fatal(opts.Servers[0])
			}
			uri := *opts.Servers[0]
			uri.Host = server.Listener.Addr().String()
			conn, err := new(commandReadiness).open(&uri, *opts)
			if conn != nil {
				conn.Close()
			}
			if (err == nil) != tc.valid {
				t.Fatalf("unexpected handshake: %v", err)
			}
		})
	}
	opts, err := brokerOptions(config{Ip: "::1", Port: "1883"})
	if err != nil || opts.Servers[0].String() != "tcp://[::1]:1883" {
		t.Fatalf("legacy options %v %v", opts, err)
	}
	if _, err = brokerOptions(config{Ip: "localhost", Port: "1883", CAFile: file}); err == nil {
		t.Fatal("accepted CA without TLS")
	}
}

type readinessToken struct {
	mqtt.Token
	done   chan struct{}
	result map[string]byte
	err    error
}

func (t *readinessToken) Done() <-chan struct{}   { return t.done }
func (t *readinessToken) Error() error            { return t.err }
func (t *readinessToken) Result() map[string]byte { return t.result }

type readinessBroker struct {
	mqtt.Client
	events chan string
	acks   chan *readinessToken
}

func (b *readinessBroker) IsConnectionOpen() bool { return true }
func (b *readinessBroker) Publish(topic string, qos byte, retained bool, value interface{}) mqtt.Token {
	b.events <- value.(string)
	t := &readinessToken{done: make(chan struct{})}
	if !retained {
		t.err = errors.New("expected retained availability")
	}
	close(t.done)
	return t
}
func (b *readinessBroker) Subscribe(topic string, qos byte, _ mqtt.MessageHandler) mqtt.Token {
	b.events <- "subscribe"
	return <-b.acks
}
func TestSubscriptionRetriesAndReconnect(t *testing.T) {
	topic := getTopicPrefix() + "/command/#"
	b := &readinessBroker{events: make(chan string, 12), acks: make(chan *readinessToken, 4)}
	ack := func(qos byte, complete bool) *readinessToken {
		token := &readinessToken{result: map[string]byte{topic: qos}, done: make(chan struct{})}
		if complete {
			close(token.done)
		}
		b.acks <- token
		return token
	}
	r := &commandReadiness{timeout: time.Second, retry: time.Millisecond}
	var wg sync.WaitGroup
	connect := func() { wg.Add(1); go func() { defer wg.Done(); r.connected(b) }() }
	expect := func(want ...string) {
		t.Helper()
		var got []string
		for range want {
			select {
			case e := <-b.events:
				got = append(got, e)
			case <-time.After(time.Second):
				t.Fatalf("expected %v, got %v", want, got)
			}
		}
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
	ack(0x80, true)
	old := ack(0, false)
	connect()
	expect("false", "subscribe", "false", "subscribe")
	ack(0, true)
	connect()
	expect("false", "subscribe", "true")
	close(old.done)
	wg.Wait()
	if len(b.events) != 0 {
		t.Fatal("obsolete session announced readiness")
	}
}

func TestPowerErrorAllowsNextCommand(t *testing.T) {
	if err := runPowerCommand(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("expected execution failure")
	}
	calls := 0
	action := func() error {
		calls++
		if calls == 1 {
			return errors.New("fixture rejection")
		}
		return nil
	}
	msg := powerMessage{topic: getTopicPrefix() + "/command/sleep", payload: "sleep"}
	dispatchPowerCommand(msg, map[string]func() error{"sleep": action})
	dispatchPowerCommand(msg, map[string]func() error{"sleep": action})
	msg.retained = true
	dispatchPowerCommand(msg, map[string]func() error{"sleep": action})
	if calls != 2 {
		t.Fatalf("expected both attempts, got %d", calls)
	}
}

func TestMissingSubackResetsOnlyTimedOutConnection(t *testing.T) {
	topic := getTopicPrefix() + "/command/#"
	b := &readinessBroker{events: make(chan string, 8), acks: make(chan *readinessToken, 2)}
	old := &readinessToken{done: make(chan struct{}), result: map[string]byte{topic: 0}}
	b.acks <- old
	closed := 0
	r := &commandReadiness{timeout: 20 * time.Millisecond, retry: time.Millisecond, abort: func() { closed++ }}
	r.connected(b)
	if closed != 1 {
		t.Fatal("unacknowledged session remained open")
	}
	if a, bEvent := <-b.events, <-b.events; a != "false" || bEvent != "subscribe" {
		t.Fatalf("unexpected events %q %q", a, bEvent)
	}
	close(old.done)
	fresh := &readinessToken{done: make(chan struct{}), result: map[string]byte{topic: 0}}
	close(fresh.done)
	b.acks <- fresh
	r.connected(b)
	for _, want := range []string{"false", "subscribe", "true"} {
		if got := <-b.events; got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	}
	if closed != 1 || len(b.events) != 0 {
		t.Fatal("unexpected reset or stale announcement")
	}
}
