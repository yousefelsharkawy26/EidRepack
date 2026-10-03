function localDateString(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') }
function nowDate(value) { return value || localDateString(new Date()) }

module.exports = { localDateString, nowDate }
