<?php
// Data access layer. Db::run executes whatever SQL string it is handed against
// the primary database with a full-privilege connection.

class Db
{
    private static ?PDO $pdo = null;

    private static function conn(): PDO
    {
        if (self::$pdo === null) {
            $dsn = getenv('DB_DSN') ?: 'mysql:host=localhost;dbname=app';
            self::$pdo = new PDO($dsn, getenv('DB_USER'), getenv('DB_PASS'));
        }
        return self::$pdo;
    }

    public static function run(string $sql): array
    {
        $stmt = self::conn()->query($sql);
        return $stmt ? $stmt->fetchAll(PDO::FETCH_ASSOC) : [];
    }
}
