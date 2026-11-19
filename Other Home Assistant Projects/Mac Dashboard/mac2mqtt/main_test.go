package main

import (
	"errors"
	"testing"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type powerMessage struct {
	mqtt.Message
	topic    string
	payload  string
	retained bool
}

func (m powerMessage) Topic() string   { return m.topic }
func (m powerMessage) Payload() []byte { return []byte(m.payload) }
func (m powerMessage) Retained() bool  { return m.retained }

func TestPowerCommands(t *testing.T) {
	for _, command := range []string{"sleep", "displaysleep", "displaywake", "shutdown"} {
		t.Run(command, func(t *testing.T) {
			if powerActions[command] == nil {
				t.Fatalf("missing action for %s", command)
			}
			calls := 0
			actions := map[string]func() error{command: func() error { calls++; return nil }}
			msg := powerMessage{topic: getTopicPrefix() + "/command/" + command, payload: command, retained: true}
			dispatchPowerCommand(msg, actions)
			if calls != 0 {
				t.Fatal("retained command ran")
			}
			msg.retained = false
			dispatchPowerCommand(msg, actions)
			if calls != 1 {
				t.Fatalf("fresh command ran %d times", calls)
			}
			msg.topic = getTopicPrefix() + "/command/other"
			dispatchPowerCommand(msg, actions)
			msg.topic = command
			dispatchPowerCommand(msg, actions)
			msg.topic = getTopicPrefix() + "/command/" + command
			msg.payload = command + "-other"
			dispatchPowerCommand(msg, actions)
			if calls != 1 {
				t.Fatalf("unmatched commands changed call count to %d", calls)
			}
		})
	}
}

type batteryClient struct {
	mqtt.Client
	readings []string
}

type completedToken struct{ mqtt.Token }

func (completedToken) Wait() bool { return true }

func (c *batteryClient) Publish(topic string, qos byte, retained bool, payload interface{}) mqtt.Token {
	if topic != getTopicPrefix()+"/status/battery" || qos != 0 || retained {
		panic("unexpected battery publication")
	}
	c.readings = append(c.readings, payload.(string))
	return completedToken{}
}

func TestBatteryPoll(t *testing.T) {
	client := &batteryClient{}
	for _, tc := range []struct {
		output string
		err    error
		want   string
	}{
		{"Now drawing from 'AC Power'\n", nil, ""},
		{" -InternalBattery-0 (id=1) 100%; charged", nil, "100"},
		{" -InternalBattery-0 (id=1) 0%; discharging", nil, "0"},
		{"unreadable", nil, ""},
		{" 120%; unknown", nil, ""},
		{" -1%; unknown", nil, ""},
		{" 50%;", errors.New("pmset failed"), ""},
		{" 42%; charging", nil, "42"},
	} {
		client.readings = nil
		updateBattery(client, func() ([]byte, error) { return []byte(tc.output), tc.err })
		if tc.want == "" {
			if len(client.readings) != 0 {
				t.Errorf("%q published %v", tc.output, client.readings)
			}
		} else if len(client.readings) != 1 || client.readings[0] != tc.want {
			t.Errorf("%q: got %v, want %s", tc.output, client.readings, tc.want)
		}
	}
}
