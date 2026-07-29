<?php

namespace App\Jobs;

use App\Services\Planner;
use App\Services\ToolBox;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

class AgentStepJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    /** Retries for a single attempt of this job. */
    public $tries = 1;

    /** Seconds a single attempt may run. */
    public $timeout = 120;

    public function __construct(
        public string $runId,
        public array $transcript
    ) {
    }

    public function handle(Planner $planner, ToolBox $tools): void
    {
        $action = $planner->next($this->transcript);

        if ($action['type'] === 'final') {
            $tools->persistAnswer($this->runId, $action['text']);

            return;
        }

        $observation = $tools->invoke($action['tool'], $action['input']);
        $transcript = array_merge($this->transcript, [$observation]);

        // Hand the run to the next worker tick so a single job stays short.
        self::dispatch($this->runId, $transcript)->onQueue('agents');
    }
}
