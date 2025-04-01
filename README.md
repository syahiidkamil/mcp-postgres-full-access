# PostgreSQL Full Access MCP Server

[![Model Context Protocol](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A powerful Model Context Protocol server providing **full read-write access** to PostgreSQL databases. Unlike the read-only official MCP PostgreSQL server, this enhanced implementation allows Large Language Models (LLMs) to both query and modify database content with proper transaction management and safety controls.

## Table of Contents

- [Features](#features)
  - [Full Read-Write Access](#full-read-write-access)
  - [Rich Schema Information](#rich-schema-information)
  - [Advanced Safety Controls](#advanced-safety-controls)
- [Tools](#tools)
  - [execute_query](#execute_query)
  - [execute_dml_ddl_dcl_tcl](#execute_dml_ddl_dcl_tcl)
  - [execute_commit](#execute_commit)
  - [execute_rollback](#execute_rollback)
  - [list_tables](#list_tables)
  - [describe_table](#describe_table)
- [Resources](#resources)
- [Using with Claude Desktop](#using-with-claude-desktop)
  - [Claude Desktop Integration](#claude-desktop-integration)
  - [Important: Using "Allow Once" for Safety](#important-using-allow-once-for-safety)
- [Environment Variables](#environment-variables)
- [Using Full Database Access with Claude](#using-full-database-access-with-claude)
- [Security Considerations](#security-considerations)
  - [Database User Permissions](#database-user-permissions)
  - [Best Practices for Safe Usage](#best-practices-for-safe-usage)
- [Docker](#docker)
- [License](#license)
- [Comparison with Official PostgreSQL MCP Server](#comparison-with-official-postgresql-mcp-server)

## 🌟 Features

### Full Read-Write Access

- Safely execute DML operations (INSERT, UPDATE, DELETE)
- Create, alter, and manage database objects with DDL
- Transaction management with explicit commit
- Safety timeouts and automatic rollback protection

### Rich Schema Information

- Detailed column metadata (data types, descriptions, max length, nullability)
- Primary key identification
- Foreign key relationships
- Index information with type and uniqueness flags
- Table row count estimates
- Table and column descriptions (when available)

### Advanced Safety Controls

- SQL query classification (DQL, DML, DDL, DCL, TCL)
- Enforced read-only execution for safe queries
- All operations run in isolated transactions
- Automatic transaction timeout monitoring
- Configurable safety limits
- Two-step transaction commit process with explicit user confirmation

## 🔧 Tools

- **execute_query**

  - Execute read-only SQL queries (SELECT statements)
  - Input: `sql` (string): The SQL query to execute
  - All queries are executed within a READ ONLY transaction
  - Results include execution time metrics and field information

- **execute_dml_ddl_dcl_tcl**

  - Execute data modification operations (INSERT, UPDATE, DELETE) or schema changes (CREATE, ALTER, DROP)
  - Input: `sql` (string): The SQL statement to execute
  - Automatically wrapped in a transaction with configurable timeout
  - Returns a transaction ID for explicit commit
  - **Important safety feature**: The conversation will end after execution, allowing the user to review the results before deciding to commit or rollback

- **execute_commit**

  - Explicitly commit a transaction by its ID
  - Input: `transaction_id` (string): ID of the transaction to commit
  - Safely handles cleanup after commit or rollback
  - Permanently applies changes to the database

- **execute_rollback**

  - Explicitly rollback a transaction by its ID
  - Input: `transaction_id` (string): ID of the transaction to rollback
  - Safely discards all changes and cleans up resources
  - Useful when reviewing changes and deciding not to apply them

- **list_tables**

  - Get a comprehensive list of all tables in the database
  - Includes column count and table descriptions
  - No input parameters required

- **describe_table**
  - Get detailed information about a specific table structure
  - Input: `table_name` (string): Name of the table to describe
  - Returns complete schema information including primary keys, foreign keys, indexes, and column details

## 📊 Resources

The server provides enhanced schema information for database tables:

- **Table Schemas** (`postgres://<host>/<table>/schema`)
  - Detailed JSON schema information for each table
  - Includes complete column metadata, primary keys, and constraints
  - Automatically discovered from database metadata

## 🚀 Using with Claude Desktop

### Claude Desktop Integration

To use this server with Claude Desktop, follow these steps:

1. First, ensure you have Node.js installed on your system
2. Install the package using npx or add it to your project

3. Configure Claude Desktop by editing `claude_desktop_config.json` (typically found at `~/Library/Application Support/Claude/` on macOS):

```json
{
  "mcpServers": {
    "postgres-full": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-postgres-full-access",
        "postgresql://username:password@localhost:5432/database"
      ],
      "env": {
        "TRANSACTION_TIMEOUT_MS": "60000",
        "MAX_CONCURRENT_TRANSACTIONS": "5",
        "PG_STATEMENT_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

4. Replace the database connection string with your actual PostgreSQL connection details
5. Restart Claude Desktop completely

### Important: Using "Allow Once" for Safety

When Claude attempts to commit changes to your database, Claude Desktop will prompt you for approval:

![Allow Once Dialog](https://example.com/allow-once-dialog.png)

**Always review the SQL changes carefully before approving them!**

Best practices for safety:

- Always click "Allow once" (not "Always allow") for commit operations
- Review the transaction SQL carefully before approving
- Consider using a database user with limited permissions
- Use a testing database if possible when first trying this server

This "Allow once" approach gives you full control to prevent unwanted changes to your database while still enabling Claude to help with data management tasks when needed.

## ⚙️ Environment Variables

You can customize the server behavior with environment variables in your Claude Desktop config:

```json
"env": {
  "TRANSACTION_TIMEOUT_MS": "60000",
  "MAX_CONCURRENT_TRANSACTIONS": "5"
}
```

Key environment variables:

- `TRANSACTION_TIMEOUT_MS`: Transaction timeout in milliseconds (default: 15000)

  - Increase this if your transactions need more time
  - Transactions exceeding this time will be automatically rolled back for safety

- `MAX_CONCURRENT_TRANSACTIONS`: Maximum concurrent transactions (default: 10)

  - Lower this number for more conservative operation
  - Higher values allow more simultaneous write operations

- `ENABLE_TRANSACTION_MONITOR`: Enable/disable transaction monitor ("true" or "false", default: "true")

  - Monitors and automatically rolls back abandoned transactions
  - Rarely needs to be disabled

- `PG_STATEMENT_TIMEOUT_MS`: SQL query execution timeout in ms (default: 30000)

  - Limits how long any single SQL statement can run
  - Important safety feature to prevent runaway queries

- `PG_MAX_CONNECTIONS`: Maximum PostgreSQL connections (default: 20)

  - Important to stay within your database's connection limits

- `MONITOR_INTERVAL_MS`: How often to check for stuck transactions (default: 5000)
  - Usually doesn't need adjustment

## 🔄 Using Full Database Access with Claude

This server enables Claude to both read from and write to your PostgreSQL database with your approval. Here are some example conversation flows:

### Example: Creating a New Table and Adding Data

You: "I need a new products table with columns for id, name, price, and inventory"

Claude: _Analyzes your database and creates a query_

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    inventory INTEGER DEFAULT 0
);
```

_Claude Desktop will prompt you to approve this operation_

You: _Review and click "Allow once"_

Claude: "I've created the products table. Would you like me to add some sample data?"

You: "Yes, please add 5 sample products"

Claude: _Creates INSERT statements and prompts for approval_
_You review and approve with "Allow once"_

### Example: Data Analysis with Safe Queries

You: "What are my top 3 products by price?"

Claude: _Executes a read-only query automatically_
_Shows you the results_

### Safety Workflow

The key safety feature is the two-step approach for any operation that modifies your database:

1. Claude analyzes your request and prepares SQL
2. For read-only operations (SELECT), Claude executes automatically
3. For write operations (INSERT, UPDATE, DELETE, CREATE, etc.):
   - Claude executes the SQL in a transaction and ends the conversation
   - You review the results
   - In a new conversation, you respond with "Yes" to commit or "No" to rollback
   - Claude Desktop shows you exactly what will be changed and asks for permission
   - You click "Allow once" to permit the specific operation
   - Claude executes the operation and returns results

This gives you multiple opportunities to verify changes before they're permanently applied to the database.

## ⚠️ Security Considerations

When connecting Claude to your database with write access:

### Database User Permissions

**IMPORTANT:** Create a dedicated database user with appropriate permissions:

```sql
-- Example of creating a restricted user (adjust as needed)
CREATE USER claude_user WITH PASSWORD 'secure_password';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO claude_user;
GRANT INSERT, UPDATE, DELETE ON TABLE table1, table2 TO claude_user;
-- Only grant specific permissions as needed
```

### Best Practices for Safe Usage

1. **Always use "Allow once"** to review each write operation

   - Never select "Always allow" for database modifications
   - Take time to review the SQL carefully

2. **Connect to a testing database** when first exploring this tool

   - Consider using a database copy/backup for initial testing

3. **Limit database user permissions** to only what's necessary

   - Avoid using a superuser or admin account
   - Grant table-specific permissions when possible

4. **Implement database backups** before extensive use

5. **Never share sensitive data** that shouldn't be exposed to LLMs

6. **Verify all SQL operations** before approving them
   - Check table names
   - Verify column names and data
   - Confirm WHERE clauses are appropriate
   - Look for proper transaction handling

### Docker

The server can be easily run in a Docker container:

```bash
# Build the Docker image
docker build -t mcp-postgres-full-access .

# Run the container
docker run -i --rm mcp-postgres-full-access "postgresql://username:password@host:5432/database"
```

For Docker on macOS, use host.docker.internal to connect to the host network:

```bash
docker run -i --rm mcp-postgres-full-access "postgresql://username:password@host.docker.internal:5432/database"
```

## 📄 License

This MCP server is licensed under the MIT License.

## 💡 Comparison with Official PostgreSQL MCP Server

| Feature             | This Server            | Official MCP PostgreSQL Server |
| ------------------- | ---------------------- | ------------------------------ |
| Read Access         | ✅                     | ✅                             |
| Write Access        | ✅                     | ❌                             |
| Schema Details      | Enhanced               | Basic                          |
| Transaction Support | Explicit with timeouts | Read-only                      |
| Index Information   | ✅                     | ❌                             |
| Foreign Key Details | ✅                     | ❌                             |
| Row Count Estimates | ✅                     | ❌                             |
| Table Descriptions  | ✅                     | ❌                             |

## Author

Created by Syahiid Nur Kamil ([@syahiidkamil](https://github.com/syahiidkamil))

---

Copyright © 2024 Syahiid Nur Kamil. All rights reserved.
