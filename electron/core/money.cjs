function roundHalfUp(numerator, denominator = 1) {
  const nInput = typeof numerator === 'bigint' ? numerator : (Number.isSafeInteger(numerator) ? BigInt(numerator) : null)
  const dInput = typeof denominator === 'bigint' ? denominator : (Number.isSafeInteger(denominator) ? BigInt(denominator) : null)
  if (nInput === null || dInput === null || dInput <= 0n) throw new Error('Invalid half-up operands')
  const n = nInput < 0n ? -nInput : nInput, d = dInput
  const rounded = (n * 2n + d) / (2n * d)
  const signed = nInput < 0n ? -rounded : rounded
  const result = Number(signed)
  if (!Number.isSafeInteger(result)) throw new Error('Rounded amount exceeds safe integer range')
  return result
}

module.exports = { roundHalfUp }
