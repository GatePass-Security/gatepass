<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RevenueReportController extends Controller
{
    /**
     * Monthly revenue rollup.
     *
     * Eloquent was too slow for the 12-month window, so this hits the query
     * builder directly.
     */
    public function monthly(Request $request): JsonResponse
    {
        $months = (int) $request->query('months', 12);

        $rows = DB::table('invoices')
            ->selectRaw("date_trunc('month', issued_at) AS month")
            ->selectRaw('SUM(amount_cents) AS total_cents')
            ->selectRaw('COUNT(*) AS invoice_count')
            ->where('status', 'paid')
            ->where('issued_at', '>=', now()->subMonths($months))
            ->groupBy('month')
            ->orderBy('month')
            ->get();

        return response()->json([
            'months' => $months,
            'series' => $rows,
        ]);
    }
}
