# PostgreSQL Advanced MCP Server

An enhanced Model Context Protocol server that provides advanced PostgreSQL database interaction capabilities. This server enables LLMs to inspect database schemas with rich metadata and execute read-only queries with safety checks.

## Features

### Enhanced Schema Information
- Detailed column metadata (data types, descriptions, max length, nullability)
- Primary key identification
- Foreign key relationships
- Index information
- Table row count estimates
- Table and column descriptions (when available)

### Query Safety
- SQL query classification (DQL, DML, DDL, DCL, TCL)
- Enforced read-only execution for safety
- All queries run in isolated transactions

### Tools

- **query**
  - Execute read-only SQL queries against the connected database
  - Input: `sql` (string): The SQL query to execute
  - All queries are executed within a READ ONLY transaction
  - Results include execution time metrics

- **get_tables**
  - List all tables in the database with their column count and descriptions
  - No input parameters required

- **describe_table**
  - Get comprehensive information about a specific table
  - Input: `table_name` (string): The name of the table to describe
  - Returns detailed schema information including indexes and foreign keys

### Resources

The server provides schema information for each table in the database:

- **Table Schemas** (`postgres://<host>/<table>/schema`)
  - Enhanced JSON schema information for each table
  - Includes detailed column metadata, primary keys, and constraints
  - Automatically discovered from database metadata

## Installation

```bash
# Clone the repository
git clone https://your-repository-url/postgres-advanced.git
cd postgres-advanced

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

Run the server with a PostgreSQL connection string:

```bash
npm start -- "postgresql://username:password@localhost:5432/database"
```

### Usage with Claude Desktop

To use this server with the Claude Desktop app, add the following configuration to the "mcpServers" section of your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "postgres-advanced": {
      "command": "node",
      "args": [
        "/absolute/path/to/postgres-advanced/dist/index.js",
        "postgresql://username:password@localhost:5432/database"
      ]
    }
  }
}
```

Replace the database connection string with your own PostgreSQL connection details.

## License

This MCP server is licensed under the MIT License.
