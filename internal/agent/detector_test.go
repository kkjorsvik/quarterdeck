package agent

import (
	"testing"
	"time"
)

func TestDetectorTransitionsToWorkingOnOutput(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetector("claude_code", func(s AgentStatus) {
		lastStatus = s
	})
	d.Feed([]byte("Thinking about the problem...\n"))
	time.Sleep(10 * time.Millisecond)
	if d.CurrentState() != AgentStatusWorking {
		t.Errorf("expected working, got %s", d.CurrentState())
	}
	_ = lastStatus
}

func TestDetectorNeedsInputOnPattern(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetector("claude_code", func(s AgentStatus) {
		lastStatus = s
	})
	d.Feed([]byte("Working on the code...\n"))
	d.Feed([]byte("Do you want to proceed? (Y/n) "))
	time.Sleep(700 * time.Millisecond)
	if lastStatus != AgentStatusNeedsInput {
		t.Errorf("expected needs_input, got %s", lastStatus)
	}
}

func TestDetectorNeedsInputOnIdle(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetectorWithTimeouts("custom", func(s AgentStatus) {
		lastStatus = s
	}, 500*time.Millisecond, 200*time.Millisecond)
	d.Feed([]byte("some output"))
	time.Sleep(900 * time.Millisecond)
	if lastStatus != AgentStatusNeedsInput {
		t.Errorf("expected needs_input from idle timeout, got %s", lastStatus)
	}
}

func TestDetectorDoneOnExit(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetector("claude_code", func(s AgentStatus) {
		lastStatus = s
	})
	d.Feed([]byte("Working...\n"))
	exitCode := 0
	d.OnProcessExit(&exitCode)
	if lastStatus != AgentStatusDone {
		t.Errorf("expected done, got %s", lastStatus)
	}
}

func TestDetectorErrorOnNonZeroExit(t *testing.T) {
	var lastStatus AgentStatus
	d := NewDetector("claude_code", func(s AgentStatus) {
		lastStatus = s
	})
	d.Feed([]byte("Working...\n"))
	exitCode := 1
	d.OnProcessExit(&exitCode)
	if lastStatus != AgentStatusError {
		t.Errorf("expected error, got %s", lastStatus)
	}
}

func TestStripANSI(t *testing.T) {
	input := []byte("\x1b[32mgreen text\x1b[0m normal \x1b[?25h")
	got := string(StripANSI(input))
	expected := "green text normal "
	if got != expected {
		t.Errorf("StripANSI: expected %q, got %q", expected, got)
	}
}

func TestDetectorDebouncesPreventsFlicker(t *testing.T) {
	var transitions []AgentStatus
	d := NewDetectorWithTimeouts("claude_code", func(s AgentStatus) {
		transitions = append(transitions, s)
	}, 5*time.Second, 300*time.Millisecond)
	d.Feed([]byte("Do you want to proceed? (Y/n) "))
	time.Sleep(100 * time.Millisecond)
	d.Feed([]byte("Actually, continuing...\n"))
	time.Sleep(500 * time.Millisecond)
	for _, s := range transitions {
		if s == AgentStatusNeedsInput {
			t.Error("should not have transitioned to needs_input due to debounce cancel")
		}
	}
}
