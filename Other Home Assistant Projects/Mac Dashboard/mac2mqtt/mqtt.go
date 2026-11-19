package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"golang.org/x/net/proxy"
	"log"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

func brokerOptions(c config) (*mqtt.ClientOptions, error) {
	port, err := strconv.Atoi(c.Port)
	if err != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("invalid mqtt_port")
	}
	if c.Ip == "" || (net.ParseIP(c.Ip) == nil && strings.ContainsAny(c.Ip, ":/%?#@ []\\\t\r\n")) {
		return nil, fmt.Errorf("mqtt_ip must be a broker hostname or IP address")
	}
	opts := mqtt.NewClientOptions().SetUsername(c.User).SetPassword(c.Password)
	scheme := "tcp"
	if c.TLS {
		cfg := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: c.Ip}
		if c.CAFile != "" {
			pem, err := os.ReadFile(c.CAFile)
			if err != nil {
				return nil, fmt.Errorf("read mqtt_ca_file: %w", err)
			}
			cfg.RootCAs = x509.NewCertPool()
			if !cfg.RootCAs.AppendCertsFromPEM(pem) {
				return nil, fmt.Errorf("mqtt_ca_file contains no CA certificates")
			}
		}
		opts.SetTLSConfig(cfg)
		scheme = "ssl"
	} else if c.CAFile != "" {
		return nil, fmt.Errorf("mqtt_ca_file requires mqtt_tls")
	}
	opts.AddBroker(scheme + "://" + net.JoinHostPort(c.Ip, c.Port))
	return opts, nil
}

type commandReadiness struct {
	timeout time.Duration
	abort   func()
	mu      sync.Mutex
	cancel  context.CancelFunc
	worker  sync.Mutex
	retry   time.Duration
}

// Keep the transport for this connection so a missing acknowledgement can
// trigger the broker will and Paho reconnect, even when keepalives still work.
func (r *commandReadiness) open(uri *url.URL, opts mqtt.ClientOptions) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(context.Background(), opts.ConnectTimeout)
	defer cancel()
	var dialer proxy.Dialer = opts.Dialer
	if os.Getenv("all_proxy") != "" {
		dialer = proxy.FromEnvironmentUsing(opts.Dialer)
	}
	contextDialer, ok := dialer.(proxy.ContextDialer)
	if !ok {
		return nil, fmt.Errorf("broker proxy does not support a connection deadline")
	}
	conn, err := contextDialer.DialContext(ctx, "tcp", uri.Host)
	if err != nil {
		return nil, err
	}
	if uri.Scheme == "ssl" {
		secure := tls.Client(conn, opts.TLSConfig)
		if err := secure.HandshakeContext(ctx); err != nil {
			conn.Close()
			return nil, err
		}
		conn = secure
	}
	r.mu.Lock()
	if r.cancel != nil {
		r.cancel()
	}
	r.abort = func() { conn.Close() }
	r.mu.Unlock()
	return conn, nil
}

func (r *commandReadiness) connected(client mqtt.Client) {
	r.mu.Lock()
	if r.cancel != nil {
		r.cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	abort := r.abort
	r.mu.Unlock()

	// Paho calls OnConnect asynchronously. Only one session may negotiate readiness.
	r.worker.Lock()
	defer r.worker.Unlock()
	topic := getTopicPrefix() + "/command/#"
	alive := getTopicPrefix() + "/status/alive"
	for ctx.Err() == nil && client.IsConnectionOpen() {
		attempt, finish := context.WithTimeout(ctx, r.timeout)
		err := establishReadiness(attempt, client, topic, alive)
		timedOut := attempt.Err() == context.DeadlineExceeded
		finish()
		if timedOut && ctx.Err() == nil {
			log.Println("MQTT readiness acknowledgement timed out; reconnecting")
			abort()
			return
		}
		if err == nil || ctx.Err() != nil {
			return
		}
		log.Printf("MQTT command channel unavailable: %v", err)
		timer := time.NewTimer(r.retry)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func awaitMQTT(ctx context.Context, t mqtt.Token) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.Done():
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return t.Error()
}

func establishReadiness(ctx context.Context, client mqtt.Client, topic, alive string) error {
	if err := awaitMQTT(ctx, client.Publish(alive, 1, true, "false")); err != nil {
		return err
	}
	token := client.Subscribe(topic, 0, handleMessage)
	if err := awaitMQTT(ctx, token); err != nil {
		return err
	}
	ack, ok := token.(interface{ Result() map[string]byte })
	if !ok {
		return fmt.Errorf("missing subscription acknowledgement")
	}
	qos, ok := ack.Result()[topic]
	if !ok || qos != 0 {
		return fmt.Errorf("broker rejected command subscription")
	}
	if !client.IsConnectionOpen() || ctx.Err() != nil {
		return fmt.Errorf("connection changed during subscription")
	}
	// QoS zero keeps an old online announcement out of the reconnect retransmission queue.
	return awaitMQTT(ctx, client.Publish(alive, 0, true, "true"))
}
