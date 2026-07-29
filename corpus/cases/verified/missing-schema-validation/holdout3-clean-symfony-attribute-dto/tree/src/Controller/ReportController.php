<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\ReportQuery;
use Doctrine\DBAL\Connection;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;

final class ReportController
{
    public function __construct(private readonly Connection $db)
    {
    }

    /**
     * MapRequestPayload deserialises and validates the body against
     * ReportQuery. A violation returns 422 and this method never runs, so
     * $sortColumn and $sortDir are always one of the declared choices.
     */
    #[Route('/tools/report', methods: ['POST'])]
    public function __invoke(#[MapRequestPayload] ReportQuery $query): JsonResponse
    {
        $sql = sprintf(
            'SELECT id, amount, status FROM reports WHERE created_at >= ? ORDER BY %s %s LIMIT %d',
            $query->sortColumn,
            $query->sortDir,
            $query->limit
        );

        $rows = $this->db->executeQuery($sql, [$query->since])->fetchAllAssociative();

        return new JsonResponse(['rows' => $rows]);
    }
}
