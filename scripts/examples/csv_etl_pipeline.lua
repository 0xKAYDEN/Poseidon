-- Parse CSV text, filter rows, and export cleaned CSV & JSON files to the sandbox filesystem.

return {
  run = function(context)
    local rawCsv = (context.inputs and context.inputs.csv) or [[sku,title,category,stock,status
PSD-201,Edge Cron Dispatcher,Automation,19,active
PSD-202,CSV Stream Parser,Data,42,active
PSD-203,Deprecated Tape Adapter,Legacy,0,archived]]

    local rows = csv.parse(rawCsv, { header = true })
    local activeRows = {}
    for _, row in ipairs(rows) do
      local stockNum = tonumber(row.stock) or 0
      if row.status == "active" and stockNum > 0 then
        table.insert(activeRows, {
          sku = row.sku,
          title = row.title,
          category = row.category,
          stock = stockNum,
          status = row.status
        })
      end
    end

    local exportedCsv = csv.stringify(activeRows)
    fs.write("exports/active_inventory.csv", exportedCsv)
    fs.write_json("exports/active_inventory.json", activeRows)
    flow.log("Parsed " .. tostring(#rows) .. " CSV rows; exported " .. tostring(#activeRows) .. " active rows")

    return {
      total_parsed = #rows,
      active_count = #activeRows,
      exported_csv = exportedCsv,
      rows = activeRows
    }
  end
}
