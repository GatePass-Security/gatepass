<?php

declare(strict_types=1);

namespace App\Dto;

use Symfony\Component\Validator\Constraints as Assert;

/**
 * Arguments for the report tool. Every field carries its own constraint;
 * the kernel refuses the request before the controller runs if any fail.
 */
final class ReportQuery
{
    public function __construct(
        #[Assert\Choice(choices: ['created_at', 'amount', 'status'])]
        public readonly string $sortColumn = 'created_at',

        #[Assert\Choice(choices: ['ASC', 'DESC'])]
        public readonly string $sortDir = 'DESC',

        #[Assert\Range(min: 1, max: 500)]
        public readonly int $limit = 50,

        #[Assert\Regex(pattern: '/^\d{4}-\d{2}-\d{2}$/')]
        public readonly string $since = '2024-01-01',
    ) {
    }
}
