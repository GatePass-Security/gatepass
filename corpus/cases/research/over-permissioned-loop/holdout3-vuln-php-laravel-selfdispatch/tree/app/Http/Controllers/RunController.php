<?php

namespace App\Http\Controllers;

use App\Jobs\AgentStepJob;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RunController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'goal' => ['required', 'string', 'max:2000'],
        ]);

        $runId = (string) Str::uuid();

        DB::table('agent_runs')->insert([
            'id' => $runId,
            'goal' => $data['goal'],
            'created_at' => now(),
        ]);

        AgentStepJob::dispatch($runId, [$data['goal']])->onQueue('agents');

        return new JsonResponse(['run_id' => $runId], 202);
    }
}
