function assertPositiveInt(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
}
function assertNonnegativeInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer`)
}

module.exports = { assertNonnegativeInt, assertPositiveInt }
