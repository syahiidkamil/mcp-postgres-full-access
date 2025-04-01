import pg from "pg";
import { TrackedTransaction } from "./types.js";
import { safelyReleaseClient } from "./utils.js";

export class TransactionManager {
  private activeTransactions = new Map<string, TrackedTransaction>();
  private monitorInterval: NodeJS.Timeout | null = null;
  private transactionTimeoutMs: number;
  private monitorIntervalMs: number;
  private monitorEnabled: boolean;

  constructor(
    transactionTimeoutMs: number = 15000,
    monitorIntervalMs: number = 5000,
    monitorEnabled: boolean = true
  ) {
    this.transactionTimeoutMs = transactionTimeoutMs;
    this.monitorIntervalMs = monitorIntervalMs;
    this.monitorEnabled = monitorEnabled;
  }

  /**
   * Add a new transaction to the manager
   */
  addTransaction(id: string, client: pg.PoolClient, sql: string): void {
    this.activeTransactions.set(id, {
      id,
      client,
      startTime: Date.now(),
      sql: sql.substring(0, 100), // Store beginning of query for debugging
      state: 'active',
      released: false
    });
  }

  /**
   * Get a transaction by ID
   */
  getTransaction(id: string): TrackedTransaction | undefined {
    return this.activeTransactions.get(id);
  }

  /**
   * Remove a transaction from the manager
   */
  removeTransaction(id: string): boolean {
    return this.activeTransactions.delete(id);
  }

  /**
   * Check if a transaction exists
   */
  hasTransaction(id: string): boolean {
    return this.activeTransactions.has(id);
  }

  /**
   * Get count of active transactions
   */
  get transactionCount(): number {
    return this.activeTransactions.size;
  }

  /**
   * Start the transaction monitor
   */
  startMonitor(): void {
    if (this.monitorEnabled && !this.monitorInterval) {
      console.error(`Starting transaction monitor with timeout ${this.transactionTimeoutMs}ms, checking every ${this.monitorIntervalMs}ms`);
      this.monitorInterval = setInterval(
        () => this.checkStuckTransactions(), 
        this.monitorIntervalMs
      );
    } else if (!this.monitorEnabled) {
      console.error("Transaction monitor is disabled");
    }
  }

  /**
   * Stop the transaction monitor
   */
  stopMonitor(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  /**
   * Monitor for stuck transactions and roll them back
   */
  private checkStuckTransactions(): void {
    const now = Date.now();
    let terminatedCount = 0;
    
    for (const [id, transaction] of this.activeTransactions.entries()) {
      // Skip already released transactions awaiting cleanup
      if (transaction.released) continue;
      
      const age = now - transaction.startTime;
      
      if (age > this.transactionTimeoutMs && transaction.state === 'active') {
        console.error(`Transaction ${id} has been running for ${age}ms and will be rolled back`);
        transaction.state = 'terminating';
        terminatedCount++;
        
        // Handle in async function to avoid blocking the monitor
        (async () => {
          try {
            // Attempt rollback
            await transaction.client.query("ROLLBACK");
            console.error(`Successfully rolled back stuck transaction ${id}`);
          } catch (error) {
            console.error(`Error rolling back transaction ${id}:`, error);
          } finally {
            // Mark as released before actually releasing to prevent double-release
            if (!transaction.released) {
              transaction.released = true;
              safelyReleaseClient(transaction.client);
            }
            this.removeTransaction(id);
          }
        })().catch(err => {
          console.error(`Unhandled error in transaction cleanup for ${id}:`, err);
          // Ensure cleanup even on error
          if (!transaction.released) {
            transaction.released = true;
            try {
              safelyReleaseClient(transaction.client);
            } catch (releaseErr) {
              console.error(`Final release attempt failed for ${id}:`, releaseErr);
            }
          }
          this.removeTransaction(id);
        });
      }
    }
    
    if (terminatedCount > 0) {
      console.error(`Terminated ${terminatedCount} stuck transactions. Remaining active: ${this.transactionCount}`);
    }
  }

  /**
   * Clean up any pending transactions 
   */
  async cleanupTransactions(): Promise<void> {
    console.error(`Cleaning up ${this.transactionCount} active transactions`);
    
    const transactionEntries = Array.from(this.activeTransactions.entries());
    for (const [id, transaction] of transactionEntries) {
      // Skip already released transactions
      if (transaction.released) {
        console.error(`Transaction ${id} already marked as released, skipping cleanup`);
        this.removeTransaction(id);
        continue;
      }
      
      try {
        await transaction.client.query("ROLLBACK");
        console.error(`Rolled back transaction ${id}`);
        
        // Mark as released to prevent double-release attempts
        transaction.released = true;
        safelyReleaseClient(transaction.client);
        this.removeTransaction(id);
      } catch (error) {
        console.error(`Error rolling back transaction ${id}:`, error);
        
        // Even on error, mark as released and attempt to release
        transaction.released = true;
        try {
          safelyReleaseClient(transaction.client);
        } catch (releaseErr) {
          console.error(`Final client release failed for ${id}:`, releaseErr);
        }
        this.removeTransaction(id);
      }
    }
    
    this.activeTransactions.clear();
  }
}
