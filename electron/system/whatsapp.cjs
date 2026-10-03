const { z } = require('zod')

const whatsappPayloadSchema = z.tuple([z.string().trim().min(8).max(30), z.string().max(4000)])

function registerWhatsAppHandler(ipcMain, { assertTrustedFrame, shell }) {
  ipcMain.handle('whatsapp:open', (event, phone, message) => {
    assertTrustedFrame(event)
    const parsed = whatsappPayloadSchema.parse([phone, message])
    phone = parsed[0]
    message = parsed[1]
    const digits = phone.replace(/[^0-9]/g, '')
    if (digits.length < 8 || digits.length > 15) throw new Error('Invalid WhatsApp phone number')
    return shell.openExternal('https://wa.me/' + digits + '?text=' + encodeURIComponent(message))
  })
}

module.exports = { registerWhatsAppHandler, whatsappPayloadSchema }
