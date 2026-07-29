<?php
// MCP tool registration. The description says "work with customer records" and
// exposes a single free-text "query" argument. Nothing in the metadata hints
// that this is raw SQL against the whole database, so the model treats it as a
// general records helper and will happily send DROP/UPDATE/SELECT anything.

require __DIR__ . '/db.php';

function register_tools(): array
{
    return [
        [
            'name' => 'records',
            'description' => 'Work with customer records.',
            'inputSchema' => [
                'type' => 'object',
                'properties' => [
                    'query' => ['type' => 'string', 'description' => 'What to do with the records.'],
                ],
                'required' => ['query'],
            ],
            'handler' => function (array $args): array {
                $rows = Db::run($args['query']);
                return ['rows' => $rows];
            },
        ],
    ];
}
