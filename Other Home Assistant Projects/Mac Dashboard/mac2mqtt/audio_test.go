package main

import (
	"bytes"
	"errors"
	"log"
	"reflect"
	"strings"
	"sync"
	"testing"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type audioMessage struct {
	mqtt.Message
	topic, payload string
}

func (m audioMessage) Topic() string   { return m.topic }
func (m audioMessage) Payload() []byte { return []byte(m.payload) }

type audioToken struct{ mqtt.Token }

func (audioToken) Wait() bool { return true }

type audioClient struct {
	mqtt.Client
	messages []string
}

func (c *audioClient) Publish(topic string, qos byte, retain bool, payload interface{}) mqtt.Token {
	if qos != 0 || retain {
		panic("unexpected audio publish options")
	}
	c.messages = append(c.messages, topic+"="+payload.(string))
	return audioToken{}
}

const readVolume = "output volume of (get volume settings)"
const readMute = "output muted of (get volume settings)"

func TestAudioPollRecovery(t *testing.T) {
	var poller audioPoller
	failed := errors.New("audio unavailable")
	client := &audioClient{}
	prefix := getTopicPrefix() + "/status/"
	for _, poll := range []struct {
		volume, mute       string
		volumeErr, muteErr error
		want               []string
	}{
		{"0", "", nil, failed, []string{prefix + "volume=0"}},
		{"", "false", failed, nil, []string{prefix + "mute=false"}},
		{"missing value", "true", nil, nil, []string{prefix + "mute=true"}},
		{"100", "missing value", nil, nil, []string{prefix + "volume=100"}},
		{"101", "", nil, failed, nil},
		{"-1", "", nil, failed, nil},
		{"32", "false", nil, nil, []string{prefix + "volume=32", prefix + "mute=false"}},
	} {
		client.messages = nil
		poller.updateAudio(client, func(script string) (string, error) {
			switch script {
			case readVolume:
				return poll.volume, poll.volumeErr
			case readMute:
				return poll.mute, poll.muteErr
			default:
				t.Fatalf("unexpected audio read %q", script)
				return "", nil
			}
		})
		if !reflect.DeepEqual(client.messages, poll.want) {
			t.Fatalf("volume=%q mute=%q: got %v, want %v", poll.volume, poll.mute, client.messages, poll.want)
		}
	}
}

func TestAudioCommands(t *testing.T) {
	var poller audioPoller
	for _, tc := range []struct {
		topic, payload, write string
	}{
		{"volume", "0", "set volume output volume 0"},
		{"mute", "false", "set volume output muted false"},
		{"volume", "101", ""},
		{"volume", "-1", ""},
		{"mute", "missing value", ""},
		{"other", "0", ""},
	} {
		msg := audioMessage{topic: getTopicPrefix() + "/command/" + tc.topic, payload: tc.payload}
		for _, writeFails := range []bool{false, true} {
			client := &audioClient{}
			var calls, wantCalls, wantMessages []string
			poller.handleAudioCommand(client, msg, func(script string) (string, error) {
				calls = append(calls, script)
				switch script {
				case readVolume:
					return "71", nil
				case readMute:
					return "true", nil
				case tc.write:
					if writeFails {
						return "", errors.New("write failed")
					}
				}
				return "", nil
			})
			if tc.write != "" {
				wantCalls = []string{tc.write}
				if !writeFails {
					wantCalls = append(wantCalls, readVolume, readMute)
					prefix := getTopicPrefix() + "/status/"
					wantMessages = []string{prefix + "volume=71", prefix + "mute=true"}
				}
			}
			if !reflect.DeepEqual(calls, wantCalls) || !reflect.DeepEqual(client.messages, wantMessages) {
				t.Fatalf("%s %q failure=%t: calls %v, messages %v; want %v and %v", tc.topic, tc.payload, writeFails, calls, client.messages, wantCalls, wantMessages)
			}
		}
	}
}

func TestAudioWarningsAcrossPolls(t *testing.T) {
	var poller audioPoller
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(previous)
	client := &audioClient{}
	unreadable := func(string) (string, error) { return "missing value", nil }

	// A timer poll and command readback can overlap. Both readings are invalid,
	// so neither may publish and each setting should generate only one warning.
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			poller.updateAudio(client, unreadable)
		}()
	}
	wg.Wait()
	poller.updateAudio(client, func(script string) (string, error) {
		if script == readVolume {
			return "0", nil
		}
		return "", errors.New("unavailable")
	})
	poller.updateAudio(client, unreadable)
	if len(client.messages) != 1 || client.messages[0] != getTopicPrefix()+"/status/volume=0" {
		t.Fatalf("expected only the recovered volume reading, got %v", client.messages)
	}
	for msg, want := range map[string]int{
		"Could not read volume":    2,
		"Could not read mute":      1,
		"Reading volume recovered": 1,
		"Reading mute recovered":   0,
	} {
		if got := strings.Count(logs.String(), msg); got != want {
			t.Errorf("%q appeared %d times, want %d", msg, got, want)
		}
	}
}
