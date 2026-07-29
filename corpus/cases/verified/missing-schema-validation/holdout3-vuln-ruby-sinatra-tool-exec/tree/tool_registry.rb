# frozen_string_literal: true

# Maps a tool name onto a binary and an argv builder.
module ToolRegistry
  TOOLS = {
    'grep_repo' => {
      binary: 'rg',
      argv: ->(a) { ['--json', a['pattern'], a['path']] }
    },
    'read_file' => {
      binary: 'cat',
      argv: ->(a) { [a['path']] }
    },
    'run_migration' => {
      binary: 'bundle',
      argv: ->(a) { ['exec', 'rake', "db:migrate:#{a['task']}"] }
    },
    'pack_artifacts' => {
      binary: 'tar',
      argv: ->(a) { ['-czf', a['archive'], *Array(a['include'])] }
    }
  }.freeze

  def self.fetch(name)
    TOOLS.fetch(name)
  end
end
