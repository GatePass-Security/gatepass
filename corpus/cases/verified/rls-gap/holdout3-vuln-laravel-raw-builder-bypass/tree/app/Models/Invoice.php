<?php

namespace App\Models;

use App\Scopes\TenantScope;
use Illuminate\Database\Eloquent\Model;

class Invoice extends Model
{
    protected $table = 'invoices';

    protected $fillable = ['number', 'amount_cents', 'status', 'issued_at'];

    protected $casts = [
        'amount_cents' => 'integer',
        'issued_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new TenantScope());

        static::creating(function (Invoice $invoice) {
            $invoice->tenant_id ??= auth()->user()?->tenant_id;
        });
    }
}
