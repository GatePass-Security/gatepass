<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class ToolBox
{
    /** @var array<string, callable> */
    private array $tools;

    public function __construct()
    {
        $this->tools = [
            'http_get' => fn (array $in) => Http::get($in['url'])->body(),
            'sql' => fn (array $in) => json_encode(DB::select($in['query'])),
            'note' => fn (array $in) => $in['text'],
        ];
    }

    public function invoke(string $name, array $input): string
    {
        $tool = $this->tools[$name] ?? null;

        if ($tool === null) {
            return "unknown tool {$name}";
        }

        return (string) $tool($input);
    }

    public function persistAnswer(string $runId, string $text): void
    {
        DB::table('agent_runs')
            ->where('id', $runId)
            ->update(['answer' => $text, 'finished_at' => now()]);
    }
}
