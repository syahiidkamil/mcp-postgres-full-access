import pg from "pg";

/**
 * Safely releases a client back to the pool, handling potential
 * "already released" errors gracefully
 */
export function safelyReleaseClient(client: pg.PoolClient): void {
  try {
    client.release();
  } catch (err) {
    console.error("Error releasing client (may already be released):", err);
  }
}

/**
 * Determine if a query is read-only (DQL)
 * @param sql The SQL query to analyze
 * @returns True if the query is read-only
 */
export function isReadOnlyQuery(sql: string): boolean {
  const normalizedSql = sql.trim().toUpperCase();
  return normalizedSql.startsWith("SELECT") || 
         normalizedSql.startsWith("WITH") || 
         normalizedSql.startsWith("EXPLAIN") || 
         (normalizedSql.startsWith("SHOW") && !normalizedSql.includes("CREATE"));
}

/**
 * Generate a unique transaction ID
 * @returns A unique transaction identifier
 */
export function generateTransactionId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
