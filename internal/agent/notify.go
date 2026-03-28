package agent

import "os/exec"

// Notify sends a desktop notification via notify-send.
func Notify(title, body, urgency string) {
	cmd := exec.Command("notify-send",
		"--urgency", urgency,
		"--app-name", "Quarterdeck",
		title, body,
	)
	cmd.Start()
}
