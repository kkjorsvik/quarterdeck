package agent

import "regexp"

var ansiRegex = regexp.MustCompile(`\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\x1b\].*?\x07|\x1b[()][AB012]`)

func StripANSI(data []byte) []byte {
	return ansiRegex.ReplaceAll(data, nil)
}

type AgentPatterns struct {
	NeedsInput []*regexp.Regexp
	Done       []*regexp.Regexp
	Error      []*regexp.Regexp
}

func PatternsForAgent(agentType string) *AgentPatterns {
	switch agentType {
	case "claude_code":
		return &AgentPatterns{
			NeedsInput: []*regexp.Regexp{
				regexp.MustCompile(`❯\s*$`),
				regexp.MustCompile(`\(Y/n\)`),
				regexp.MustCompile(`\(y/N\)`),
				regexp.MustCompile(`Do you want to`),
			},
			Error: []*regexp.Regexp{
				regexp.MustCompile(`(?i)^Error:`),
			},
		}
	case "codex":
		return &AgentPatterns{
			NeedsInput: []*regexp.Regexp{
				regexp.MustCompile(`Apply these changes\?`),
				regexp.MustCompile(`\(Y/n\)`),
				regexp.MustCompile(`\[y/N\]`),
			},
			Done: []*regexp.Regexp{
				regexp.MustCompile(`Changes applied`),
			},
			Error: []*regexp.Regexp{
				regexp.MustCompile(`(?i)^Error`),
				regexp.MustCompile(`(?i)^Failed`),
			},
		}
	case "opencode":
		return &AgentPatterns{
			NeedsInput: []*regexp.Regexp{
				regexp.MustCompile(`\(Y/n\)`),
				regexp.MustCompile(`\(y/N\)`),
			},
			Error: []*regexp.Regexp{
				regexp.MustCompile(`(?i)^error:`),
			},
		}
	default:
		return nil
	}
}
