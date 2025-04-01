/**
 * Configuration settings loaded from environment variables
 */
export default {
  // Transaction timeout in milliseconds (default: 15 seconds)
  transactionTimeoutMs: parseInt(process.env.TRANSACTION_TIMEOUT_MS || '15000', 10),
  
  // How often to check for stuck transactions (default: 5 seconds)
  monitorIntervalMs: parseInt(process.env.MONITOR_INTERVAL_MS || '5000', 10),
  
  // Enable/disable transaction monitor (default: enabled)
  enableTransactionMonitor: process.env.ENABLE_TRANSACTION_MONITOR !== 'false',
  
  // Maximum concurrent transactions (default: 10)
  maxConcurrentTransactions: parseInt(process.env.MAX_CONCURRENT_TRANSACTIONS || '10', 10),
  
  // PostgreSQL connection pool settings
  pg: {
    // Maximum number of clients the pool should contain
    maxConnections: parseInt(process.env.PG_MAX_CONNECTIONS || '20', 10),
    
    // Close idle clients after 30 seconds
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
    
    // Terminate backend if query takes too long
    statementTimeout: parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '30000', 10),
  }
};
