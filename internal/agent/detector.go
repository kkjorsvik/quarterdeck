package agent

import (
	"regexp"
	"sync"
	"time"
)

const (
	defaultBufSize     = 4096
	defaultIdleTimeout = 5 * time.Second
	defaultDebounce    = 500 * time.Millisecond
)

type StateDetector struct {
	patterns      *AgentPatterns
	currentState  AgentStatus
	onChange      func(AgentStatus)
	buffer        []byte
	bufSize       int
	lastOutputAt  time.Time
	idleTimeout   time.Duration
	idleTimer     *time.Timer
	debounce      time.Duration
	debounceTimer *time.Timer
	stagedState   *AgentStatus
	stopped       bool
	mu            sync.Mutex
}

func NewDetector(agentType string, onChange func(AgentStatus)) *StateDetector {
	return NewDetectorWithTimeouts(agentType, onChange, defaultIdleTimeout, defaultDebounce)
}

func NewDetectorWithTimeouts(agentType string, onChange func(AgentStatus), idleTimeout, debounce time.Duration) *StateDetector {
	return &StateDetector{
		patterns:     PatternsForAgent(agentType),
		currentState: AgentStatusStarting,
		onChange:     onChange,
		buffer:       make([]byte, 0, defaultBufSize),
		bufSize:      defaultBufSize,
		idleTimeout:  idleTimeout,
		debounce:     debounce,
	}
}

func (d *StateDetector) CurrentState() AgentStatus {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.currentState
}

func (d *StateDetector) Feed(data []byte) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stopped {
		return
	}

	// Rolling buffer
	d.buffer = append(d.buffer, data...)
	if len(d.buffer) > d.bufSize {
		d.buffer = d.buffer[len(d.buffer)-d.bufSize:]
	}
	d.lastOutputAt = time.Now()

	// Reset idle timer
	if d.idleTimer != nil {
		d.idleTimer.Stop()
	}
	d.idleTimer = time.AfterFunc(d.idleTimeout, d.onIdleTimeout)

	// Transition to working
	if d.currentState != AgentStatusWorking {
		d.currentState = AgentStatusWorking
		d.onChange(AgentStatusWorking)
	}

	// Cancel staged transition — new output invalidates it
	if d.debounceTimer != nil {
		d.debounceTimer.Stop()
		d.stagedState = nil
	}

	// Check regex patterns against latest data (not full buffer)
	// to avoid stale matches re-triggering after cancellation.
	if d.patterns != nil {
		stripped := StripANSI(data)
		if d.matchAny(d.patterns.NeedsInput, stripped) {
			d.stageTransition(AgentStatusNeedsInput)
		} else if d.matchAny(d.patterns.Done, stripped) {
			d.stageTransition(AgentStatusDone)
		} else if d.matchAny(d.patterns.Error, stripped) {
			d.stageTransition(AgentStatusError)
		}
	}
}

func (d *StateDetector) OnProcessExit(exitCode *int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.stopped = true
	if d.idleTimer != nil {
		d.idleTimer.Stop()
	}
	if d.debounceTimer != nil {
		d.debounceTimer.Stop()
	}

	if exitCode != nil && *exitCode != 0 {
		d.currentState = AgentStatusError
		d.onChange(AgentStatusError)
	} else {
		d.currentState = AgentStatusDone
		d.onChange(AgentStatusDone)
	}
}

func (d *StateDetector) Stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.stopped = true
	if d.idleTimer != nil {
		d.idleTimer.Stop()
	}
	if d.debounceTimer != nil {
		d.debounceTimer.Stop()
	}
}

func (d *StateDetector) stageTransition(state AgentStatus) {
	s := state
	d.stagedState = &s
	d.debounceTimer = time.AfterFunc(d.debounce, func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.stopped {
			return
		}
		if d.stagedState != nil && *d.stagedState == state {
			d.currentState = state
			d.stagedState = nil
			d.onChange(state)
		}
	})
}

func (d *StateDetector) onIdleTimeout() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.stopped {
		return
	}
	if d.stagedState == nil {
		d.stageTransition(AgentStatusNeedsInput)
	}
}

func (d *StateDetector) matchAny(patterns []*regexp.Regexp, data []byte) bool {
	for _, p := range patterns {
		if p.Match(data) {
			return true
		}
	}
	return false
}
