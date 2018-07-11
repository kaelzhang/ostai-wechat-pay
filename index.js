const {
  Payment,
  xmlParse,
  xmlStringify,
  sign
} = require('./lib/payment')

module.exports = {
  Payment,
  xmlParse,
  xmlStringify,
  sign,
  fail: return_msg => xmlStringify({
    return_code: 'FAIL',
    return_msg
  }),
  success: () => xmlStringify({
    return_code: 'SUCCESS'
  })
}
