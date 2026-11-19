package main

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type audioScript func(string) (string, error)

func runAudioScript(script string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/bin/osascript", "-e", script).Output()
	return strings.TrimSpace(string(out)), err
}

func volumeValue(raw string) (string, error) {
	n, err := strconv.Atoi(raw)
	if err != nil || n < 0 || n > 100 {
		return "", fmt.Errorf("expected a volume between 0 and 100")
	}
	return strconv.Itoa(n), nil
}

func muteValue(raw string) (string, error) {
	muted, err := strconv.ParseBool(raw)
	if err != nil {
		return "", fmt.Errorf("expected a boolean mute setting")
	}
	return strconv.FormatBool(muted), nil
}

// Timer polls and command readbacks share these per-setting warning states.
type audioPoller struct {
	volumeFailed atomic.Bool
	muteFailed   atomic.Bool
}

var systemAudio audioPoller

func (p *audioPoller) updateAudio(client mqtt.Client, run audioScript) {
	publish := func(topic, script string, parse func(string) (string, error), failed *atomic.Bool) {
		raw, err := run(script)
		var value string
		if err == nil {
			value, err = parse(raw)
		}
		wasFailed := failed.Swap(err != nil)
		if err != nil {
			if !wasFailed {
				log.Printf("Could not read %s: %v", topic, err)
			}
			return
		}
		if wasFailed {
			log.Printf("Reading %s recovered", topic)
		}
		client.Publish(getTopicPrefix()+"/status/"+topic, 0, false, value).Wait()
	}

	publish("volume", "output volume of (get volume settings)", volumeValue, &p.volumeFailed)
	publish("mute", "output muted of (get volume settings)", muteValue, &p.muteFailed)
}

func (p *audioPoller) handleAudioCommand(client mqtt.Client, msg mqtt.Message, run audioScript) {
	var value, script string
	var err error
	switch msg.Topic() {
	case getTopicPrefix() + "/command/volume":
		value, err = volumeValue(string(msg.Payload()))
		script = "set volume output volume " + value
	case getTopicPrefix() + "/command/mute":
		value, err = muteValue(string(msg.Payload()))
		script = "set volume output muted " + value
	default:
		return
	}
	if err != nil {
		log.Printf("Ignoring invalid audio command: %v", err)
		return
	}
	if _, err := run(script); err != nil {
		log.Printf("Could not apply audio command: %v", err)
		return
	}
	p.updateAudio(client, run)
}
