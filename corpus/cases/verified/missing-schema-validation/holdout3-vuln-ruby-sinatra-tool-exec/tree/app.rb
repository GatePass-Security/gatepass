# frozen_string_literal: true

require 'sinatra'
require 'json'
require 'open3'

require_relative 'tool_registry'

set :port, 4567

# The assistant posts the tool name plus whatever arguments it invented.
post '/agent/tool_call' do
  call = JSON.parse(request.body.read)
  tool = ToolRegistry.fetch(call['name'])
  args = call['arguments'] || {}

  stdout, status = Open3.capture2(
    tool[:binary],
    *tool[:argv].call(args),
    chdir: args.fetch('workdir', Dir.pwd)
  )

  content_type :json
  { ok: status.success?, output: stdout }.to_json
end

get '/agent/tools' do
  content_type :json
  { tools: ToolRegistry::TOOLS.keys }.to_json
end

error KeyError do
  status 404
  'no such tool'
end
