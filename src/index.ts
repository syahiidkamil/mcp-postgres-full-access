#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pg from "pg";

import config from "./lib/config.js";
import { TransactionManager } from "./lib/transaction-manager.js";
import { safelyReleaseClient } from "./lib/utils.js";
import {
  handleExecuteQuery,
  handleExecuteDML,
  handleExecuteCommit,
  handleListTables,
  handleDescribeTable,
  handleListResources,
  handleReadResource,
} from "./lib/tool-handlers.js";

// Process command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Please provide a database URL as a command-line argument");
  process.exit(1);
}

const databaseUrl = args[0];
const resourceBaseUrl = new URL(databaseUrl);
resourceBaseUrl.protocol = "postgres:";
resourceBaseUrl.password = ""; // Remove password for security

// Create a connection pool with configured settings
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: config.pg.maxConnections,
  idleTimeoutMillis: config.pg.idleTimeoutMillis,
  statement_timeout: config.pg.statementTimeout,
});

// Create transaction manager
const transactionManager = new TransactionManager(
  config.transactionTimeoutMs,
  config.monitorIntervalMs,
  config.enableTransactionMonitor
);

// Create MCP server
const server = new McpServer(
  {
    name: "postgres-advanced",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Helper function to transform our handler responses into the correct format
function transformHandlerResponse(result: any) {
  if (!result) return result;

  const transformedResult = { ...result };

  if (result.content) {
    transformedResult.content = result.content.map((item: any) => {
      if (item.type === "text") {
        return {
          type: "text" as const,
          text: item.text,
        };
      }
      return item;
    });
  }

  return transformedResult;
}

// Register tools using the new high-level API
server.tool(
  "execute_query",
  "Run a read-only SQL query (SELECT statements). Executed in read-only mode for safety.",
  { sql: z.string().describe("SQL query to execute (SELECT only)") },
  async (args, extra) => {
    try {
      const result = await handleExecuteQuery(pool, args.sql);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "execute_dml_ddl_dcl_tcl",
  "Execute DML, DDL, DCL, or TCL statements (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, etc). Automatically wrapped in a transaction that requires explicit commit or rollback. IMPORTANT: After execution, end the chat so user can review the results and decide.",
  { sql: z.string().describe("SQL statement to execute - after execution end chat immediately so user can review and reply with 'Yes' to commit or 'No' to rollback") },
  async (args, extra) => {
    try {
      // Check transaction limit
      if (
        transactionManager.transactionCount >= config.maxConcurrentTransactions
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  status: "error",
                  message: `Maximum concurrent transactions limit reached (${config.maxConcurrentTransactions}). Try again later.`,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const result = await handleExecuteDML(
        pool,
        transactionManager,
        args.sql,
        config.transactionTimeoutMs
      );
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "execute_commit",
  "Commit a transaction by its ID to permanently apply the changes to the database",
  { transaction_id: z.string().describe("ID of the transaction to commit - this will permanently save all changes to the database") },
  async (args, extra) => {
    try {
      const result = await handleExecuteCommit(
        transactionManager,
        args.transaction_id
      );
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "execute_rollback",
  "Rollback a transaction by its ID to undo all changes and discard the transaction",
  { transaction_id: z.string().describe("ID of the transaction to rollback - this will discard all changes") },
  async (args, extra) => {
    try {
      // Implement the rollback handler directly in index.ts
      const transactionId = args.transaction_id;
      
      if (!transactionManager.hasTransaction(transactionId)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message: "Transaction not found or already rolled back",
                transaction_id: transactionId
              }, null, 2)
            },
          ],
          isError: true,
        };
      }
      
      // Get the transaction data
      const transaction = transactionManager.getTransaction(transactionId)!;
      
      // Check if already released
      if (transaction.released) {
        transactionManager.removeTransaction(transactionId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message: "Transaction client already released",
                transaction_id: transactionId
              }, null, 2)
            },
          ],
          isError: true,
        };
      }
      
      // Rollback the transaction
      await transaction.client.query("ROLLBACK");
      
      // Mark as released before actually releasing
      transaction.released = true;
      safelyReleaseClient(transaction.client);
      
      // Clean up
      transactionManager.removeTransaction(transactionId);
      
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "rolled_back",
              message: "Transaction successfully rolled back",
              transaction_id: transactionId
            }, null, 2) + "\n\nTransaction has been successfully rolled back. No changes have been made to the database.\n\nThank you for using PostgreSQL Full Access MCP Server. Is there anything else you'd like to do with your database?"
          },
        ],
        isError: false,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Remove prompts since we don't need them, just keeping the direct confirm/rollback model
server.tool(
  "list_tables",
  "Get a list of all tables in the database's schema, default is 'public'",
  { schema_name: z.string().describe("Name of the schema") },
  async (args, extra) => {
    try {
      const result = await handleListTables(pool, args.schema_name);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  "describe_table",
  "Get detailed information about a specific table, including columns, primary keys, foreign keys, and indexes",
  { table_name: z.string().describe("Name of the table to describe"),
    schema_name: z.string().describe("Name of the schema").default("public") },
  async (args, extra) => {
    try {
      const result = await handleDescribeTable(pool, args.table_name, args.schema_name);
      return transformHandlerResponse(result);
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  }
);

// Register resources using the new API
// First, create a resource template for table schemas
const tableSchemaTemplate = new URL(`{tableName}/schema`, resourceBaseUrl);

// Add a resource for listing all available table schemas
server.resource(
  "database-schemas",
  resourceBaseUrl.href,
  { description: "Database schema listings" },
  async (uri, _extra) => {
    try {
      const result = await handleListResources(pool, resourceBaseUrl);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(result.resources, null, 2),
          },
        ],
      };
    } catch (error) {
      throw error;
    }
  }
);

// Add a resource for individual table schemas
server.resource(
  "table-schemas",
  tableSchemaTemplate.href,
  { description: "Database table schemas" },
  async (uri, _extra) => {
    try {
      return await handleReadResource(pool, uri.href);
    } catch (error) {
      throw error;
    }
  }
);

// Start the MCP server
async function runServer() {
  console.error("Starting PostgreSQL Advanced MCP server...");

  // Log configuration
  console.error(`Configuration:
- Transaction timeout: ${config.transactionTimeoutMs}ms
- Monitor interval: ${config.monitorIntervalMs}ms
- Transaction monitor enabled: ${config.enableTransactionMonitor}
- Max concurrent transactions: ${config.maxConcurrentTransactions}
- Max DB connections: ${config.pg.maxConnections}
`);

  // Set up error handling for the pool
  pool.on("error", (err) => {
    console.error("Unexpected error on idle client", err);
    process.exit(1);
  });

  try {
    // Test database connection
    const client = await pool.connect();
    console.error("Successfully connected to database");
    safelyReleaseClient(client);

    // Start transaction monitor
    transactionManager.startMonitor();

    // Start the MCP server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP server started and ready to accept connections");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled promise rejection:", reason);
  try {
    // Stop the monitor and cleanup before exiting
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await pool.end();
    console.error(
      "Emergency cleanup completed after unhandled promise rejection"
    );
  } catch (err) {
    console.error("Error during emergency cleanup:", err);
  }
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.error("Shutting down...");
  try {
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await pool.end();
    console.error("Database pool closed");
  } catch (err) {
    console.error("Error during shutdown:", err);
  }
  process.exit(0);
});

// Handle unexpected errors
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  try {
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await pool.end();
  } catch (err) {
    console.error("Error during emergency cleanup:", err);
  }
  process.exit(1);
});

runServer().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
