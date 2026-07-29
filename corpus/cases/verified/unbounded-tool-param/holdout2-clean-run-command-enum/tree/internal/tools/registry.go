package tools

import (
	"github.com/invopop/jsonschema"
)

// Descriptor is a tool definition as advertised to the model.
type Descriptor struct {
	Name        string             `json:"name"`
	Description string             `json:"description"`
	Parameters  *jsonschema.Schema `json:"parameters"`
}

// Descriptors returns every tool this agent exposes, with parameter schemas
// reflected straight off the argument structs.
func Descriptors() []Descriptor {
	reflector := &jsonschema.Reflector{
		ExpandedStruct:             true,
		RequiredFromJSONSchemaTags: true,
		DoNotReference:             true,
	}

	return []Descriptor{
		{
			Name:        "run_command",
			Description: "Run one of the repository's whitelisted build commands.",
			Parameters:  reflector.Reflect(&RunCommandArgs{}),
		},
	}
}
