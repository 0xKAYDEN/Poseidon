-- Example Poseidon node script: run a read-only query against the MySQL database.
-- Inputs expected: { sql = "...", params = { ... } }

return {
  run = function(context)
    local inputs = context.inputs or {}
    local sql = inputs.sql or "SELECT 1 AS ok"
    local params = inputs.params or {}

    local rows = db.query(sql, table.unpack(params))

    flow.log("DB query returned " .. tostring(#rows) .. " rows")

    return {
      row_count = #rows,
      rows = rows
    }
  end
}
