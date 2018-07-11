const crypto = require('crypto')

function AES(key, algorithm) {
  if (!this instanceof AES) {
    return new AES()
  }

  var iv = algorithm.indexOf('ecb') > -1 ? '' : key
  this.cipher = crypto.createCipheriv(algorithm, key, iv)
  this.decipher = crypto.createDecipheriv(algorithm, key, iv)
  this.decipher.setAutoPadding(false)

  return this
}

AES.prototype.decode = function(str, inputEncoding, outputEncoding) {
  inputEncoding = inputEncoding || 'base64'
  outputEncoding = outputEncoding || 'utf8'

  var decipherChunks = []
  decipherChunks.push(this.decipher.update(str, inputEncoding, outputEncoding))
  decipherChunks.push(this.decipher.final(outputEncoding))
  return decipherChunks.join('')
}

exports.AES = AES

const createHash = (string, type) => {
  const hash = crypto.createHash(type)
  hash.update(string)
  return hash.digest('hex')
}

const SIGN_TYPE_MD5 = 'MD5'
const SIGN_TYPE_SHA1 = 'SHA1'

module.exports = {
  AES,
  SIGN_TYPE_MD5,
  SIGN_TYPE_SHA1,
  cipher: {
    [SIGN_TYPE_MD5]: s => createHash(s, 'MD5'),
    [SIGN_TYPE_SHA1]: s => createHash(s, 'SHA1')
  }
}
