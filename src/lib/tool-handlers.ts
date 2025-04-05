export async function handleExecuteRollback(
  transactionManager: TransactionManager, 
  transactionId: string
) {
  if (!transactionId) {
    return {
      content: [{ type: "text", text: "Error: No transaction ID provided" }],
      isError: true,
    };
  }
  
  // Check if transaction exists
  if (!transactionManager.hasTransaction(transactionId)) {
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "error",
          message: "Transaction not found or already rolled back",
          transaction_id: transactionId
        }, null, 2) 
      }],
      isError: true,
    };
  }
  
  // Get the transaction data
  const transaction = transactionManager.getTransaction(transactionId)!;
  
  // Check if already released
  if (transaction.released) {
    transactionManager.removeTransaction(transactionId);
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "error",
          message: "Transaction client already released",
          transaction_id: transactionId
        }, null, 2) 
      }],
      isError: true,
    };
  }
  
  try {
    // Rollback the transaction
    await transaction.client.query("ROLLBACK");
    
    // Mark as released before actually releasing
    transaction.released = true;
    safelyReleaseClient(transaction.client);
    
    // Clean up
    transactionManager.removeTransaction(transactionId);
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "rolled_back",
          message: "Transaction successfully rolled back",
          transaction_id: transactionId
        }, null, 2) + "\n\nTransaction has been successfully rolled back. No changes have been made to the database.\n\nThank you for using PostgreSQL Full Access MCP Server. Is there anything else you'd like to do with your database?"
      }],
      isError: false,
    };
  } catch (error: any) {
    // If there's an error during rollback
    // Mark as released before actually releasing
    transaction.released = true;
    safelyReleaseClient(transaction.client);
    
    // Clean up
    transactionManager.removeTransaction(transactionId);
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "error",
          message: `Error rolling back transaction: ${error.message}`,
          transaction_id: transactionId
        }, null, 2) 
      }],
      isError: true,
    };
  }
}import pg from "pg";
import { TransactionManager } from "./transaction-manager.js";
import { isReadOnlyQuery, safelyReleaseClient, generateTransactionId } from "./utils.js";
import { SCHEMA_PATH } from "./types.js";

export async function handleExecuteQuery(pool: pg.Pool, sql: string) {
  const client = await pool.connect();
  try {
    if (!sql) {
      safelyReleaseClient(client);
      return {
        content: [{ type: "text", text: "Error: No SQL query provided" }],
        isError: true,
      };
    }
    
    // Validate that the query is read-only
    if (!isReadOnlyQuery(sql)) {
      safelyReleaseClient(client);
      return {
        content: [{ 
          type: "text", 
          text: "Error: Only SELECT queries are allowed with execute_query. For other operations, use execute_dml_ddl_dcl_tcl."
        }],
        isError: true,
      };
    }
    
    // Execute the query in a read-only transaction
    await client.query("BEGIN TRANSACTION READ ONLY");
    const startTime = Date.now();
    const result = await client.query(sql);
    const execTime = Date.now() - startTime;
    
    await client.query("COMMIT");
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          rows: result.rows,
          rowCount: result.rowCount,
          fields: result.fields.map(f => ({
            name: f.name,
            dataTypeID: f.dataTypeID
          })),
          execution_time_ms: execTime
        }, null, 2) 
      }],
      isError: false,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleExecuteDML(
  pool: pg.Pool, 
  transactionManager: TransactionManager, 
  sql: string,
  transactionTimeoutMs: number
) {
  const client = await pool.connect();
  try {
    if (!sql) {
      safelyReleaseClient(client);
      return {
        content: [{ type: "text", text: "Error: No SQL statement provided" }],
        isError: true,
      };
    }
    
    // Begin a transaction
    await client.query("BEGIN");
    
    // Generate transaction ID
    const transactionId = generateTransactionId();
    
    try {
      // Execute the SQL statement
      const startTime = Date.now();
      const result = await client.query(sql);
      const execTime = Date.now() - startTime;
      
      // Store client in active transactions
      transactionManager.addTransaction(transactionId, client, sql);
      
      // Don't release the client - it's now associated with the transaction
      
      // Format a more user-friendly message that prompts for commit
      const resultObj = {
        transaction_id: transactionId,
        status: "pending",
        result: {
          command: result.command,
          rowCount: result.rowCount,
          execution_time_ms: execTime
        },
        timeout_ms: transactionTimeoutMs
      };
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify(resultObj, null, 2) + "\n\nThe SQL statement has been executed successfully and a transaction has been started.\n\nPLEASE REVIEW THE RESULTS ABOVE AND FOLLOW THESE STEPS:\n1. This conversation will now end so you can review the changes carefully\n2. After reviewing, start a new message and:\n   - Type 'Yes' to COMMIT this transaction and save changes permanently\n   - Type 'No' to ROLLBACK this transaction and discard all changes\n\nThe transaction will automatically roll back if not committed within " + Math.floor(transactionTimeoutMs/1000) + " seconds.\n\nTransaction ID: " + transactionId + "\n\n*** END OF CONVERSATION ***"
        }],
        isError: false,
      };
    } catch (error: any) {
      // If there's an error, roll back and release the client
      await client.query("ROLLBACK");
      safelyReleaseClient(client);
      
      return {
        content: [{ 
          type: "text", 
          text: JSON.stringify({
            status: "error",
            message: `Error executing statement: ${error.message}`,
            sql: sql
          }, null, 2) 
        }],
        isError: true,
      };
    }
  } catch (error: any) {
    // If there's an error starting the transaction
    safelyReleaseClient(client);
    throw error;
  }
}

export async function handleExecuteCommit(
  transactionManager: TransactionManager, 
  transactionId: string
) {
  if (!transactionId) {
    return {
      content: [{ type: "text", text: "Error: No transaction ID provided" }],
      isError: true,
    };
  }
  
  // Check if transaction exists
  if (!transactionManager.hasTransaction(transactionId)) {
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "error",
          message: "Transaction not found or already committed",
          transaction_id: transactionId
        }, null, 2) 
      }],
      isError: true,
    };
  }
  
  // Get the transaction data
  const transaction = transactionManager.getTransaction(transactionId)!;
  
  // Check if already released
  if (transaction.released) {
    transactionManager.removeTransaction(transactionId);
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "error",
          message: "Transaction client already released",
          transaction_id: transactionId
        }, null, 2) 
      }],
      isError: true,
    };
  }
  
  try {
    // Commit the transaction
    await transaction.client.query("COMMIT");
    
    // Mark as released before actually releasing
    transaction.released = true;
    safelyReleaseClient(transaction.client);
    
    // Clean up
    transactionManager.removeTransaction(transactionId);
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "committed",
          message: "Transaction successfully committed",
          transaction_id: transactionId
        }, null, 2) + "\n\nTransaction has been successfully committed. All changes have been saved to the database.\n\nThank you for using PostgreSQL Full Access MCP Server. Is there anything else you'd like to do with your database?"
      }],
      isError: false,
    };
  } catch (error: any) {
    // If there's an error during commit, try to roll back
    try {
      await transaction.client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Error during rollback:", rollbackError);
    }
    
    // Mark as released before actually releasing
    transaction.released = true;
    safelyReleaseClient(transaction.client);
    
    // Clean up
    transactionManager.removeTransaction(transactionId);
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          status: "error",
          message: `Error committing transaction: ${error.message}`,
          transaction_id: transactionId
        }, null, 2) 
      }],
      isError: true,
    };
  }
}

export async function handleListTables(pool: pg.Pool, schemaName: string = "public") {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        t.table_name, 
        pg_catalog.obj_description(pgc.oid, 'pg_class') as table_description,
        (SELECT COUNT(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) as column_count
      FROM 
        information_schema.tables t
      JOIN 
        pg_catalog.pg_class pgc ON t.table_name = pgc.relname
      WHERE 
        t.table_schema = '${schemaName}'
        AND t.table_type = 'BASE TABLE'
      ORDER BY 
        t.table_name
    `);
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify(result.rows, null, 2)
      }],
      isError: false,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleDescribeTable(pool: pg.Pool, tableName: string, schemaName: string = "public") {
  if (!tableName) {
    return {
      content: [{ type: "text", text: "Error: No table name provided" }],
      isError: true,
    };
  }
  
  const client = await pool.connect();
  try {
    // Get column information
    const columnsResult = await client.query(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        column_default,
        is_nullable,
        col_description(pg_class.oid, columns.ordinal_position) as column_description
      FROM 
        information_schema.columns
      JOIN 
        pg_class ON pg_class.relname = columns.table_name
      WHERE 
        columns.table_name = '${tableName}'
        AND columns.table_schema = '${schemaName}'
      ORDER BY 
        ordinal_position
    `);
    
    // Get primary key information
    const pkResult = await client.query(`
      SELECT 
        a.attname as column_name
      FROM 
        pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE 
        i.indrelid = '${schemaName}.${tableName}'::regclass
        AND i.indisprimary
    `);
    
    // Get foreign key information
    const fkResult = await client.query(`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM
        information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = '${tableName}' AND tc.table_schema = '${schemaName}'
    `);
    
    // Get table description
    const tableDescResult = await client.query(`
      SELECT pg_catalog.obj_description(pgc.oid, 'pg_class') as table_description
      FROM pg_catalog.pg_class pgc
      WHERE pgc.relname = '${tableName}' AND pgc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${schemaName}')
    `);
    
    // Get approximate row count
    const rowCountResult = await client.query(`
      SELECT reltuples::bigint AS approximate_row_count
      FROM pg_class
      WHERE relname = '${tableName}' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${schemaName}')
    `);
    
    // Get indexes
    const indexesResult = await client.query(`
      SELECT
        i.relname AS index_name,
        am.amname AS index_type,
        array_agg(a.attname) AS column_names,
        ix.indisunique AS is_unique
      FROM
        pg_class t,
        pg_class i,
        pg_index ix,
        pg_attribute a,
        pg_am am
      WHERE
        t.oid = ix.indrelid
        AND i.oid = ix.indexrelid
        AND a.attrelid = t.oid
        AND a.attnum = ANY(ix.indkey)
        AND i.relam = am.oid
        AND t.relkind = 'r'
        AND t.relname = '${tableName}' AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${schemaName}')
      GROUP BY
        i.relname,
        am.amname,
        ix.indisunique
      ORDER BY
        i.relname
    `);
    
    return {
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          schema_name: schemaName,
          table_name: tableName,
          description: tableDescResult.rows[0]?.table_description || null,
          approximate_row_count: rowCountResult.rows[0]?.approximate_row_count || 0,
          columns: columnsResult.rows,
          primary_keys: pkResult.rows.map(row => row.column_name),
          foreign_keys: fkResult.rows,
          indexes: indexesResult.rows
        }, null, 2)
      }],
      isError: false,
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleListResources(pool: pg.Pool, resourceBaseUrl: URL) {
  const client = await pool.connect();
  try {
    // Get all tables from the public schema
    const result = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    
    return {
      resources: result.rows.map((row) => ({
        uri: new URL(`${row.table_name}/${SCHEMA_PATH}`, resourceBaseUrl).href,
        mimeType: "application/json",
        name: `"${row.table_name}" database schema`,
      })),
    };
  } finally {
    safelyReleaseClient(client);
  }
}

export async function handleReadResource(pool: pg.Pool, resourceUri: string) {
  const resourceUrl = new URL(resourceUri);
  const pathComponents = resourceUrl.pathname.split("/");
  const schema = pathComponents.pop();
  const tableName = pathComponents.pop();

  if (schema !== SCHEMA_PATH) {
    throw new Error("Invalid resource URI");
  }

  const client = await pool.connect();
  try {
    // Get column information for the requested table
    const columnsResult = await client.query(
      `SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        column_default,
        is_nullable
      FROM 
        information_schema.columns 
      WHERE 
        table_name = $1
      ORDER BY 
        ordinal_position`,
      [tableName]
    );
    
    // Get primary key information
    const pkResult = await client.query(`
      SELECT 
        a.attname as column_name
      FROM 
        pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE 
        i.indrelid = $1::regclass
        AND i.indisprimary
    `, [`public.${tableName}`]);
    
    const primaryKeys = pkResult.rows.map(row => row.column_name);
    
    // Format the column information with additional details
    const formattedColumns = columnsResult.rows.map(column => {
      return {
        column_name: column.column_name,
        data_type: column.data_type,
        max_length: column.character_maximum_length,
        default_value: column.column_default,
        nullable: column.is_nullable === 'YES',
        is_primary_key: primaryKeys.includes(column.column_name)
      };
    });

    // Return the enhanced schema information
    return {
      contents: [
        {
          uri: resourceUri,
          mimeType: "application/json",
          text: JSON.stringify({
            table_name: tableName,
            columns: formattedColumns,
            primary_keys: primaryKeys,
          }, null, 2),
        },
      ],
    };
  } finally {
    safelyReleaseClient(client);
  }
}
