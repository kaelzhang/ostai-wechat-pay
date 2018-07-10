const request = require('request')
const xml2js = require('xml2js')
const https = require('https')
const url_mod = require('url')
const nonce = require('nonce-str')
const {stringify} = require('query-string')
const {escape} = require('querystring')
const crypto = require('crypto')

const createHash = (string, type) => {
  const hash = crypto.createHash(type)
  hash.update(string)
  return hash.digest('hex')
}

const nonce32 = () => nonce(32)
const wechatTimestamp = () => String(parseInt(Date.now() / 1000, 10))

const xmlStringify = obj =>
  return new xml2js.Builder({
    allowSurrogateChars: true
  })
  .buildObject({xml: obj})

const xmlParse = xml =>
  xml2js.parseString(xml, {
    trim: true,
    explicitArray: false
  })

const toArr = rows => {
  const titles = rows[0].split(',')
  const bodys = rows.splice(1)
  const data = []

  bodys.forEach(row => {
    const rowData = {}
    row.split(',').forEach((cell, i) => {
      rowData[titles[i]] = cell.split('`')[1]
    })
    data.push(rowData)
  })

  return data
}
const parseCsv = text => {
  const rows = text.trim().split(/\r?\n/)

  return {
    list: toArr(rows.slice(0, rows.length - 2)),
    stat: toArr(rows.slice(rows.length - 2, rows.length))[0]
  }
}

const error = (code, message, data) => {
  const err = new Error(message)
  err.code = code
  if (data) {
    err.data = data
  }
  return err
}

const SIGN_TYPE_MD5 = 'MD5'
const SIGN_TYPE_SHA1 = 'SHA1'
const signTypes = {
  [SIGN_TYPE_MD5]: s => createHash(s, SIGN_TYPE_MD5),
  [SIGN_TYPE_SHA1]: s => createHash(s, SIGN_TYPE_SHA1)
}

const RETURN_CODES = {
  SUCCESS: 'SUCCESS',
  FAIL: 'FAIL'
}

// const DOWNLOAD_BILL = 'https://api.mch.weixin.qq.com/pay/downloadbill'

const https = true
const DEFAULT_REQUIRED_UNIFIED_ORDER = [
  'body', 'out_trade_no', 'total_fee', 'spbill_create_ip', 'trade_type'
]
const DEFAULT_ENSURES = [
  'appid', 'mch_id', 'sub_mch_id', 'nonce_str'
]
const TRADE_TYPE_JSAPI = 'JSAPI'
const TRADE_TYPE_NATIVE = 'NATIVE'
const TRADE_TYPE_MWEB = 'MWEB'

function getMerchantDefaults () {
  return {
    mchid: this.merchant_id,
    mch_appid: this.app_id
  }
}

const METHODS = {
  sendRedPacket: {
    url: 'https://api.mch.weixin.qq.com/mmpaymkttransfers/sendredpack',
    ensures: [
      'mch_id',
      'nonce_str'
    ],
    defaults () {
      return {
        wxappid: this.app_id
      }
    },
    required: [
      'mch_billno', 'send_name', 're_openid', 'total_amount', 'total_num',
      'wishing', 'client_ip', 'act_name', 'remark'
    ],
    https
  },

  queryRedPackets: {
    url: 'https://api.mch.weixin.qq.com/mmpaymkttransfers/gethbinfo',
    defaults: {
      bill_type: 'MCHT'
    },
    required: ['mch_billno'],
    https
  },

  transfers: {
    url: 'https://api.mch.weixin.qq.com/mmpaymkttransfers/promotion/transfers',
    ensures: ['nonce_str']
    defaults: getMerchantDefaults,
    required: [
      'mch_appid', 'partner_trade_no', 'openid', 'check_name',
      'amount', 'desc', 'spbill_create_ip'
    ],
    https
  },

  queryTransfers: {
    url: 'https://api.mch.weixin.qq.com/mmpaymkttransfers/gettransferinfo',
    defaults: getMerchantDefaults,
    required: ['partner_trade_no'],
    https
  },

  shortenUrl: {
    url: 'https://api.mch.weixin.qq.com/tools/shorturl',
    required: ['long_url']
  },

  refundQuery: {
    url: 'https://api.mch.weixin.qq.com/pay/refundquery',
    required: ['transaction_id|out_trade_no|out_refund_no|refund_id']
  },

  refund: {
    url: 'https://api.mch.weixin.qq.com/secapi/pay/refund',
    ensures: ['op_user_id'],
    required: [
      'transaction_id|out_trade_no', 'out_refund_no',
      'total_fee', 'refund_fee'
    ],
    https
  },

  unifiedOrder: {
    url: 'https://api.mch.weixin.qq.com/pay/unifiedorder',
    defaults () {
      return {
        notify_url: this._notify_url
      }
    },
    required ({trade_type}) {
      const required = trade_type === TRADE_TYPE_JSAPI
        ? ['openid|sub_openid']
        : trade_type === TRADE_TYPE_NATIVE
          ? ['product_id']
          : []

      return DEFAULT_REQUIRED_UNIFIED_ORDER.concat(required)
    }
  },

  closeOrder: {
    url: 'https://api.mch.weixin.qq.com/pay/closeorder',
    required: ['out_trade_no']
  },

  queryOrders: {
    url: 'https://api.mch.weixin.qq.com/pay/orderquery',
    required: ['transaction_id|out_trade_no']
  }
}

exports.Payment = class Payment {
  constructor ({
    app_id,
    merchant_secret,
    merchant_id,
    sub_merchant_id,
    notify_url,
    passphrase,
    pfx
  }) {
    this.app_id = app_id
    this.merchant_secret = merchant_secret
    this.merchant_id = merchant_id
    this.sub_merchant_id = sub_merchant_id
    this.notify_url = notify_url
    this.passphrase = passphrase || merchant_id
    this.pfx = pfx
  }

  _httpRequest (url, body, callback) {
    request({
      url: url,
      method: 'POST',
      body
    }, (err, response, body) => {
      if (err) {
        return callback(err)
      }

      callback(null, body)
    })
  }

  _httpsRequest (url, data, callback) {
    const parsed_url = url_mod.parse(url)
    const req = https.request({
      host: parsed_url.host,
      port: 443,
      path: parsed_url.path,
      pfx: this.pfx,
      passphrase: this.passphrase,
      method: 'POST'
    }, res => {
      let content = ''
      res.on('data', chunk => {
        content += chunk
      })
      res.on('end', () => {
        callback(null, content)
      })
    })

    req.on('error', err => callback(err))
    req.write(data)
    req.end()
  }

  // @param  {Object} obj
  // @param  {Array<string>} keys the keys to extend
  // @return {Object} the extended object
  _ensures (obj, keys) {
    const defaults = {
      appid: this.app_id,
      mch_id: this.merchant_id,
      sub_mch_id: this.sub_merchant_id,
      nonce_str: nonce32(),
      notify_url: this.notify_url,
      op_user_id: this.merchant_id,
      pfx: this.pfx
    }

    const extended = {
      ...obj
    }

    keys.forEach(key => {
      if (key in extended) {
        return
      }

      extended[key] = defaults[key]
    })

    return extended
  }

  async requestPayment (params) {
    const order = this._ensures(params, [
      'notify_url'
    ])

    const data = await this.unifiedOrder(order)

    const payment = {
      timeStamp: wechatTimestamp(),
      nonceStr: nonce32(),
      signType: 'MD5'
    }

    payment.package = `prepay_id=${data.prepay_id}`
    payment.paySign = this._getSign(payment)
    payment.timestamp = payment.timeStamp

    const ret = {
      app_id: this.app_id,
      payment
    }

    if (order.trade_type == TRADE_TYPE_NATIVE) {
      ret.code_url = data.code_url
    } else if (order.trade_type == TRADE_TYPE_MWEB){
      ret.mweb_url = data.mweb_url
    }

    return ret
  }

  async _query (type, params) {
    const {
      ensures = DEFAULT_ENSURES,
      required = [],
      defaults,
      url,
      https
    } = METHODS[type]

    params = this._ensures(params, ensures)
    if (params.long_url) {
      params.long_url = escape(params.long_url)
    }

    for (const key in params) {
      if (params[key] !== undefined && params[key] !== null) {
        params[key] = params[key].toString()
      }
    }

    params.sign = this._getSign(params)

    const missing = []
    required.forEach(function(key) {
      const alters = key.split('|')
      for (const i = alters.length - 1; i >= 0; i--) {
        if (params[alters[i]]) {
          return
        }
      }
      missing.push(key)
    })

    if (missing.length) {
      throw `missing params: ${missing.join(',')}`
    }

    const result = await this._request(url, xmlStringify(params), https)
    return this._validate(result)
  }

  _request (url, xml, https) {
    const request = https
      ? this._httpsRequest
      : this._httpRequest

    return new Promise((resolve, reject) => {
      request(url, xml, (err, body) => {
        if (err) {
          return reject(err)
        }

        resolve(body)
      })
    })
  }

  // Get sign of an object
  _getSign (obj, signType = SIGN_TYPE_MD5) {
    const nosigned = {
      ...obj
    }

    delete nosigned.sign

    return signTypes[signType](
      `${stringify(nosigned)}$key=${this.merchant_secret}}`
    ).toUpperCase()
  }

  _validate (xml) {
    const json = xmlParse(xml)
    const data = json
      ? json.xml
      : {}

    if (data.return_code == RETURN_CODES.FAIL) {
      throw error(data.return_msg, 'WECHAT_RETURN_FAIL', data)
    }

    if (data.result_code == RETURN_CODES.FAIL) {
      throw error(data.err_code_des, data.err_code, data)
    }

    if (data.appid && this.app_id !== data.appid) {
      throw error('invalid app id', 'INVALID_APP_ID', data)
    }

    if (
      data.mch_id && this.merchant_id !== data.mch_id
      || data.mchid && this.merchant_id !== data.mchid
    ) {
      throw error('invalid mch id', 'INVALID_MCH_ID', data)
    }

    if (this.sub_merchant_id && this.sub_merchant_id !== data.sub_mch_id) {
      throw error('invalid sub mch id', 'INVALID_SUB_MCH_ID', data)
    }

    if (data.sign && this._getSign(data) !== data.sign) {
      throw error('invalid signature', 'INVALID_SIGN', data)
    }

    return data
  }
}

const proto = Payment.prototype
Object.keys(METHODS).forEach(name => {
  proto[name] = function (params) {
    return this._query(name, params)
  }
})


/**
 * Generate parameters for `WeixinJSBridge.invoke('editAddress', parameters)`.
 *
 * @param  {String}   data.url  Referer URL that call the API. *Note*: Must contain `code` and `state` in querystring.
 * @param  {String}   data.accessToken
 * @param  {Function} callback(err, params)
 *
 * @see https://pay.weixin.qq.com/wiki/doc/api/jsapi.php?chapter=7_9
 */
// Payment.prototype.getEditAddressParams = function(data, callback) {
//   if (!(data.url && data.accessToken)) {
//     const err = new Error('Missing url or accessToken')
//     return callback(err)
//   }

//   const params = {
//     app_id: this.app_id,
//     scope: 'jsapi_address',
//     signType: 'SHA1',
//     timeStamp: wechatTimestamp(),
//     nonceStr: nonce32(),
//   }
//   const signParams = {
//     appid: params.app_id,
//     url: data.url,
//     timestamp: params.timeStamp,
//     noncestr: params.nonceStr,
//     accesstoken: data.accessToken,
//   }
//   const string = stringify(signParams)
//   params.addrSign = signTypes[params.signType](string)
//   callback(null, params)
// }


// Payment.prototype.downloadBill = function(params, callback) {
//   const this = this
//   this._signedQuery(URLS.DOWNLOAD_BILL, params, {
//     required: ['bill_date', 'bill_type']
//   }, function(err, rawData) {
//     if (err) {
//       if (err.name == 'XMLParseError') {
//         callback(null, this._parseCsv(rawData))
//       } else {
//         callback(err)
//       }
//     }
//   })
// }

