// A tool named "execute_sql" — deliberately scary — but the `query` argument is
// not SQL. It selects one of a closed set of prepared statements, and the only
// free value is a positional integer bound as a parameter. There is no path to
// arbitrary SQL: an unknown name is rejected.

use std::collections::HashMap;

fn allowed() -> HashMap<&'static str, &'static str> {
    HashMap::from([
        ("active_users", "SELECT id, name FROM users WHERE active = ?1"),
        ("order_total", "SELECT SUM(amount) FROM orders WHERE user_id = ?1"),
    ])
}

/// Handler for the `execute_sql` MCP tool.
/// `query` must be one of the allowlisted names; `arg` is bound as a parameter.
pub fn execute_sql(query: &str, arg: i64) -> Result<String, String> {
    let sql = allowed()
        .get(query)
        .ok_or_else(|| format!("unknown query: {query}"))?;
    // db.prepare(sql).bind(arg) — parameterized, never string-concatenated.
    Ok(format!("would run `{sql}` with param {arg}"))
}

fn main() {
    match execute_sql("active_users", 1) {
        Ok(plan) => println!("{plan}"),
        Err(e) => eprintln!("{e}"),
    }
}
