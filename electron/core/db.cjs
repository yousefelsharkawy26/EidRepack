function one(db, sql, params) { return db.prepare(sql).get(...params) }
function requiredRow(row, message) { if (!row) throw new Error(message); return row }

module.exports = { one, requiredRow }
