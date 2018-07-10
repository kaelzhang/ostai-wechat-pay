const md5 = require('md5')
const sha1 = require('sha1')
const request = require('request')
const _ = require('underscore')
const xml2js = require('xml2js')
const https = require('https')
const url_mod = require('url')
const nonce = require('nonce-str')
const {stringify} = require('query-string')

const nonce32 = () => nonce(32)
const wechatTimestamp = () => String(parseInt(Date.now() / 1000, 10))

const SIGN_TYPE_MD5 = 'SIGN_TYPE_MD5'
const signTypes = {
  [SIGN_TYPE_MD5]: md5,
  SHA1: sha1
}

const RETURN_CODES = {
  SUCCESS: 'SUCCESS',
  FAIL: 'FAIL'
}

const URLS = {
  UNIFIED_ORDER: 'https://api.mch.weixin.qq.com/pay/unifiedorder',
  ORDER_QUERY: 'https://api.mch.weixin.qq.com/pay/orderquery',
  REFUND: 'https://api.mch.weixin.qq.com/secapi/pay/refund',
  REFUND_QUERY: 'https://api.mch.weixin.qq.com/pay/refundquery',
  DOWNLOAD_BILL: 'https://api.mch.weixin.qq.com/pay/downloadbill',
  SHORT_URL: 'https://api.mch.weixin.qq.com/tools/shorturl',
  CLOSE_ORDER: 'https://api.mch.weixin.qq.com/pay/closeorder',
  REDPACK_SEND: 'https://api.mch.weixin.qq.com/mmpaymkttransfers/sendredpack',
  REDPACK_QUERY: 'https://api.mch.weixin.qq.com/mmpaymkttransfers/gethbinfo',
  TRANSFERS: 'https://api.mch.weixin.qq.com/mmpaymkttransfers/promotion/transfers',
  TRANSFERS_QUERY: 'https://api.mch.weixin.qq.com/mmpaymkttransfers/gettransferinfo',
}

const REQUIRED_PROPS = {
  REDPACK_SEND: [
    'mch_billno', 'send_name', 're_openid', 'total_amount', 'total_num',
    'wishing', 'client_ip', 'act_name', 'remark'
  ]
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

  // @param  {Object} obj
  // @param  {Array<string>} keys the keys to extend
  // @return {Object} the extended object
  _defaults (obj, keys) {
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

  async requestPayment (options) {
    const default_params = {
      app_id: this.app_id,
      timeStamp: wechatTimestamp(),
      nonceStr: nonce32(),
      signType: 'MD5'
    }

    const order = this._extendWithDefault(options, [
      'notify_url'
    ])

    const data = await this.unifiedOrder(order)

    const {
      app_id,
      ...others
    } = default_params

    const ret = {
      app_id: app_id,
      payment: _.extend(others, {
        package: 'prepay_id=' + data.prepay_id
      })
    }

    const {payment} = ret

    payment.paySign = this._getSign(payment)

    if (order.trade_type == 'NATIVE') {
      ret.code_url = data.code_url
    }else if(order.trade_type == 'MWEB'){
      ret.mweb_url = data.mweb_url
    }

    payment.timestamp = payment.timeStamp

    return ret
  }

  async _query (type, params, options) {
    const required = options.required || []

    if (url == URLS.REDPACK_SEND) {
      params = this._extendWithDefault(params, [
        'mch_id',
        'nonce_str'
      ])
    } else if (url == URLS.TRANSFERS) {
      params = this._extendWithDefault(params, [
        'nonce_str'
      ])
    } else {
      params = this._extendWithDefault(params, [
        'appid',
        'mch_id',
        'sub_mch_id',
        'nonce_str'
      ])
    }

    params = _.extend({
      'sign': this._getSign(params)
    }, params)

    if (params.long_url) {
      params.long_url = encodeURIComponent(params.long_url)
    }

    for (const key in params) {
      if (params[key] !== undefined && params[key] !== null) {
        params[key] = params[key].toString()
      }
    }

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
      return callback('missing params ' + missing.join(','))
    }

    const result = this._request(url, this.buildXml(params), options.https)
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

  _getSign (obj, signType = SIGN_TYPE_MD5) {
    const nosigned = {
      ...obj
    }

    delete nosigned.sign

    return signTypes[signType](
      `${stringify(nosigned)}$key=${this.merchant_secret}}`
    ).toUpperCase()
  }

  sendRedPacket (order) {
    const default_params = {
      wxappid: this.app_id
    }

    order = _.extend(order, default_params)

    return this._signedQuery('REDPACK_SEND', order, {
      https: true
    })
  }

  redPacketQuery (order) {
    const this = this
    const default_params = {
      bill_type: 'MCHT'
    }

    order = _.extend(order, default_params)

    const requiredData = ['mch_billno']

    return this._signedQuery(URLS.REDPACK_QUERY, order, {
      https: true,
      required: requiredData
    }, callback)
  }
}


Payment.prototype.

Payment.prototype.transfers = function(order, callback) {
  const this = this
  const default_params = {
    mchid: this.merchant_id,
    mch_appid: this.app_id
  }

  order = _.extend(order, default_params)

  const requiredData = ['mch_appid', 'partner_trade_no', 'openid', 'check_name', 'amount', 'desc', 'spbill_create_ip']

  this._signedQuery(URLS.TRANSFERS, order, {
    https: true,
    required: requiredData
  }, callback)
}

Payment.prototype.transfersQuery = function(order, callback) {
  const this = this
  const default_params = {
    mch_id: this.merchant_id,
    appid: this.app_id
  }

  order = _.extend(order, default_params)

  const requiredData = ['partner_trade_no']

  this._signedQuery(URLS.TRANSFERS_QUERY, order, {
    https: true,
    required: requiredData
  }, callback)
}

/**
 * Generate parameters for `WeixinJSBridge.invoke('editAddress', parameters)`.
 *
 * @param  {String}   data.url  Referer URL that call the API. *Note*: Must contain `code` and `state` in querystring.
 * @param  {String}   data.accessToken
 * @param  {Function} callback(err, params)
 *
 * @see https://pay.weixin.qq.com/wiki/doc/api/jsapi.php?chapter=7_9
 */
Payment.prototype.getEditAddressParams = function(data, callback) {
  if (!(data.url && data.accessToken)) {
    const err = new Error('Missing url or accessToken')
    return callback(err)
  }

  const params = {
    app_id: this.app_id,
    scope: 'jsapi_address',
    signType: 'SHA1',
    timeStamp: wechatTimestamp(),
    nonceStr: nonce32(),
  }
  const signParams = {
    appid: params.app_id,
    url: data.url,
    timestamp: params.timeStamp,
    noncestr: params.nonceStr,
    accesstoken: data.accessToken,
  }
  const string = stringify(signParams)
  params.addrSign = signTypes[params.signType](string)
  callback(null, params)
}

Payment.prototype._httpRequest = function(url, data, callback) {
  request({
    url: url,
    method: 'POST',
    body: data
  }, function(err, response, body) {
    if (err) {
      return callback(err)
    }

    callback(null, body)
  })
}

Payment.prototype._httpsRequest = function(url, data, callback) {
  const parsed_url = url_mod.parse(url)
  const req = https.request({
    host: parsed_url.host,
    port: 443,
    path: parsed_url.path,
    pfx: this.pfx,
    passphrase: this.passphrase,
    method: 'POST'
  }, function(res) {
    const content = ''
    res.on('data', function(chunk) {
      content += chunk
    })
    res.on('end', function() {
      callback(null, content)
    })
  })

  req.on('error', function(e) {
    callback(e)
  })
  req.write(data)
  req.end()
}

Payment.prototype.

Payment.prototype.unifiedOrder = function(params, callback) {
  const requiredData = ['body', 'out_trade_no', 'total_fee', 'spbill_create_ip', 'trade_type']
  if (params.trade_type == 'JSAPI') {
    requiredData.push('openid|sub_openid')
  } else if (params.trade_type == 'NATIVE') {
    requiredData.push('product_id')
  }
  params.notify_url = params.notify_url || this.notify_url
  this._signedQuery(URLS.UNIFIED_ORDER, params, {
    required: requiredData
  }, callback)
}

Payment.prototype.orderQuery = function(params, callback) {
  this._signedQuery(URLS.ORDER_QUERY, params, {
    required: ['transaction_id|out_trade_no']
  }, callback)
}

Payment.prototype.refund = function(params, callback) {
  params = this._extendWithDefault(params, [
    'op_user_id'
  ])

  this._signedQuery(URLS.REFUND, params, {
    https: true,
    required: ['transaction_id|out_trade_no', 'out_refund_no', 'total_fee', 'refund_fee']
  }, callback)
}

Payment.prototype.refundQuery = function(params, callback) {
  this._signedQuery(URLS.REFUND_QUERY, params, {
    required: ['transaction_id|out_trade_no|out_refund_no|refund_id']
  }, callback)
}

Payment.prototype.downloadBill = function(params, callback) {
  const this = this
  this._signedQuery(URLS.DOWNLOAD_BILL, params, {
    required: ['bill_date', 'bill_type']
  }, function(err, rawData) {
    if (err) {
      if (err.name == 'XMLParseError') {
        callback(null, this._parseCsv(rawData))
      } else {
        callback(err)
      }
    }
  })
}

Payment.prototype.shortUrl = function(params, callback) {
  this._signedQuery(URLS.SHORT_URL, params, {
    required: ['long_url']
  }, callback)
}

Payment.prototype.closeOrder = function(params, callback) {
  this._signedQuery(URLS.CLOSE_ORDER, params, {
    required: ['out_trade_no']
  }, callback)
}

Payment.prototype._parseCsv = function(text) {
  const rows = text.trim().split(/\r?\n/)

  function toArr(rows) {
    const titles = rows[0].split(',')
    const bodys = rows.splice(1)
    const data = []

    bodys.forEach(function(row) {
      const rowData = {}
      row.split(',').forEach(function(cell, i) {
        rowData[titles[i]] = cell.split('`')[1]
      })
      data.push(rowData)
    })
    return data
  }

  return {
    list: toArr(rows.slice(0, rows.length - 2)),
    stat: toArr(rows.slice(rows.length - 2, rows.length))[0]
  }
}

Payment.prototype.buildXml = function(obj) {
  const builder = new xml2js.Builder({
    allowSurrogateChars: true
  })
  const xml = builder.buildObject({
    xml: obj
  })
  return xml
}

Payment.prototype.validate = function(xml, callback) {
  const this = this
  xml2js.parseString(xml, {
    trim: true,
    explicitArray: false
  }, function(err, json) {
    if (err) {
      const error = new Error('fails to parse xml')
      err.code = 'XML_PARSE_ERROR'
      err.xml = xml
      return callback(err)
    }

    let error = null

    data = json ? json.xml : {}

    if (data.return_code == RETURN_CODES.FAIL) {
      error = new Error(data.return_msg)
      error.code = 'WECHAT_RETURN_FAIL'
    } else if (data.result_code == RETURN_CODES.FAIL) {
      error = new Error(data.err_code_des)
      error.code = data.err_code
    } else if (data.appid && this.app_id !== data.appid) {
      error = new Error('invalid app id')
      error.code = 'INVALID_APP_ID'
    } else if (
      data.mch_id && this.merchant_id !== data.mch_id
      || data.mchid && this.merchant_id !== data.mchid
    ) {
      error = new Error('invalid mch id')
      error.name = 'INVALID_MCH_ID'
    } else if (this.sub_merchant_id && this.sub_merchant_id !== data.sub_mch_id) {
      error = new Error('invalid sub mch id')
      error.name = 'INVALID_SUB_MCH_ID'
    } else if (data.sign && this._getSign(data) !== data.sign) {
      error = new Error('invalid signature')
      error.name = 'INVALID_SIGN'
    }

    if (error) {
      error.data = data
    }

    callback(error, data)
  })
}
