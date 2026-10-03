const { z } = require('zod')

const pageSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().regex(/^\d+$/).optional()
}).strict()

module.exports = { pageSchema }
