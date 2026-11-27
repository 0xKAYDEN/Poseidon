-- Build formatted notifications with text.template(), db.find(), and encoding helpers.

return {
  run = function(context)
    local rows = db.find("items", { status = "active" })
    local lines = {}
    for _, item in ipairs(rows) do
      table.insert(lines, text.template("- [{{sku}}] {{title}} ({{stock}} in stock)", item))
    end

    local report = text.template([[
Poseidon Inventory Report ({{date}})
Active SKUs: {{count}}
Slug Tag: {{slug}}
{{items}}
]], {
      date = flow.now(),
      count = #rows,
      slug = text.slugify("Poseidon Inventory Report"),
      items = table.concat(lines, "\n")
    })

    fs.write("reports/latest_inventory.txt", report)
    flow.log("Generated report (" .. tostring(#report) .. " bytes)")

    return {
      report = report,
      base64_preview = encoding.base64_encode(string.sub(report, 1, 80)),
      active_count = #rows
    }
  end
}
