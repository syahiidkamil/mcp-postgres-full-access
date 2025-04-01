#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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
  handleReadResource
} from "./lib/tool-handlers.js";

// Server setup
const server = new Server(
  {
    name: "postgres-advanced",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

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

// Register resource handlers
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return handleListResources(pool, resourceBaseUrl);
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  return handleReadResource(pool, request.params.uri);
});

// Register tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "execute_query",
        description: "Run a read-only SQL query (SELECT statements). Executed in read-only mode for safety.",
        inputSchema: {
          type: "object",
          properties: {
            sql: { 
              type: "string",
              description: "SQL query to execute (SELECT only)"
            },
          },
          required: ["sql"]
        },
      },
      {
        name: "execute_dml_ddl_dcl_tcl",
        description: "Execute DML, DDL, DCL, or TCL statements (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, etc). Automatically wrapped in a transaction.",
        inputSchema: {
          type: "object",
          properties: {
            sql: { 
              type: "string",
              description: "SQL statement to execute"
            },
          },
          required: ["sql"]
        },
      },
      {
        name: "execute_commit",
        description: "Commit a transaction by its ID",
        inputSchema: {
          type: "object",
          properties: {
            transaction_id: { 
              type: "string",
              description: "ID of the transaction to commit"
            },
          },
          required: ["transaction_id"]
        },
      },
      {
        name: "list_tables",
        description: "Get a list of all tables in the database",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "describe_table",
        description: "Get detailed information about a specific table",
        inputSchema: {
          type: "object",
          properties: {
            table_name: { 
              type: "string",
              description: "Name of the table to describe"
            },
          },
          required: ["table_name"]
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    // Handle different tools
    switch (request.params.name) {
      case "execute_query": {
        const sql = request.params.arguments?.sql as string;
        return await handleExecuteQuery(pool, sql);
      }
      
      case "execute_dml_ddl_dcl_tcl": {
        // Check transaction limit
        if (transactionManager.transactionCount >= config.maxConcurrentTransactions) {
          return {
            content: [{ 
              type: "text", 
              text: JSON.stringify({
                status: "error",
                message: `Maximum concurrent transactions limit reached (${config.maxConcurrentTransactions}). Try again later.`
              }, null, 2) 
            }],
            isError: true,
          };
        }
        
        const sql = request.params.arguments?.sql as string;
        return await handleExecuteDML(pool, transactionManager, sql, config.transactionTimeoutMs);
      }
      
      case "execute_commit": {
        const transactionId = request.params.arguments?.transaction_id as string;
        return await handleExecuteCommit(transactionManager, transactionId);
      }
      
      case "list_tables": {
        return await handleListTables(pool);
      }
      
      case "describe_table": {
        const tableName = request.params.arguments?.table_name as string;
        return await handleDescribeTable(pool, tableName);
      }
      
      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error: any) {
    console.error(`Error executing tool ${request.params.name}:`, error);
    
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

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
  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
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
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled promise rejection:', reason);
  try {
    // Stop the monitor and cleanup before exiting
    transactionManager.stopMonitor();
    await transactionManager.cleanupTransactions();
    await pool.end();
    console.error("Emergency cleanup completed after unhandled promise rejection");
  } catch (err) {
    console.error("Error during emergency cleanup:", err);
  }
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
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
process.on('uncaughtException', async (error) => {
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

runServer().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
