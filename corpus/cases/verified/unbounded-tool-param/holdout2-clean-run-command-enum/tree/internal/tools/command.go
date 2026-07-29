package tools

import (
	"context"
	"fmt"
	"os/exec"
)

// RunCommandArgs is the argument schema advertised for the run_command tool.
// Both fields are closed sets, so the model can never supply free-form text.
type RunCommandArgs struct {
	Command string `json:"command" jsonschema:"required,enum=build,enum=test,enum=lint,enum=format"`
	Package string `json:"package" jsonschema:"required,enum=api,enum=worker,enum=cli"`
}

// commandTable maps each allowed command name onto a fixed argv.
var commandTable = map[string][]string{
	"build":  {"go", "build", "./..."},
	"test":   {"go", "test", "./..."},
	"lint":   {"golangci-lint", "run"},
	"format": {"gofmt", "-l", "."},
}

// packageDir maps each allowed package name onto a fixed working directory.
var packageDir = map[string]string{
	"api":    "services/api",
	"worker": "services/worker",
	"cli":    "cmd/cli",
}

// RunCommand executes one of the whitelisted build commands in one of the
// whitelisted package directories.
func RunCommand(ctx context.Context, args RunCommandArgs) (string, error) {
	argv, ok := commandTable[args.Command]
	if !ok {
		return "", fmt.Errorf("unsupported command %q", args.Command)
	}
	dir, ok := packageDir[args.Package]
	if !ok {
		return "", fmt.Errorf("unsupported package %q", args.Package)
	}

	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%s %s: %w", args.Command, args.Package, err)
	}
	return string(out), nil
}
