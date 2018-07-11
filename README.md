# 微信支付 for Nodejs

## 初始化

```js
const {Payment} = require('@ostai/wechat-pay')
const payment = new Payment({
  app_id: '微信公众平台 app id',
  mch_id: '微信支付商户 id',
  mch_secret: '微信支付商户 secret',
  notify_url: '支付结果通知回调地址',
  pfx: fs.readFileSync('/path/to/your-apiclient-cert.p12')
})
```

所有参数都不是必须的，不过这样配置最省事。实际调用时候的参数若有同名会覆盖。

## 付个钱

```js
const result = await payment.requestPayment({
  body: '吮指原味鸡 * 1',
  attach: '{"部位":"三角"}',
  out_trade_no: 'kfc' + (+new Date),
  total_fee: 10 * 100,
  ip: '8.8.8.8',
  open_id: '<user open id>',
  trade_type: 'JSAPI'
})
```

注：
1. 页面的路径需要位于`支付授权目录`下
2. 由于每次呼出支付界面，无论用户是否支付成功，out_trade_no 都会失效（OUT_TRADE_NO_USED），所以这里使用timestamp保证每次的id不同。业务逻辑中应该自行维护之


前端通过（示例小程序）

```javascript
wx.requestPayment({
  ...result.payment,
  success (res) {
    console.log('支付成功', res)
  },
  fail (res) {
    console.log('支付失败', res)
  }
})
```
来呼出微信的支付界面

## 接收微信付款确认请求
```js
var middleware = require('wechat-pay').middleware
app.use('<notifyUrl>', middleware(initConfig).getNotify().done(function(message, req, res, next) {
  var openid = message.openid
  var order_id = message.out_trade_no
  var attach = {}
  try{
   attach = JSON.parse(message.attach)
  }catch(e){}

  /**
   * 查询订单，在自己系统里把订单标为已处理
   * 如果订单之前已经处理过了直接返回成功
   */
  res.reply('success')

  /**
   * 有错误返回错误，不然微信会在一段时间里以一定频次请求你
   * res.reply(new Error('...'))
   */
}))
```

## 退个款

```javascript
payment.refund({
  out_trade_no: 'kfc001',
  out_refund_no: 'kfc001_refund',
  total_fee: 10 * 100,
  refund_fee: 10 * 100
}, function(err, result){
  /**
   * 微信收到正确的请求后会给用户退款提醒
   * 这里一般不用处理，有需要的话有err的时候记录一下以便排查
   */
})
```

### 接收退款确认请求

```javascript
var middleware = require('wechat-pay').middleware
app.use('<notifyUrl>', middleware(initConfig).getRefundNotify().done(function(message, req, res, next) {
  var openid = message.openid
  var refund_order_id = message.out_refund_no
  var order_id = message.out_trade_no
  var attach = {}
  try{
   attach = JSON.parse(message.attach)
  }catch(e){}

  /**
   * 查询订单，在自己系统里把订单标为已处理
   * 如果订单之前已经处理过了直接返回成功
   */
  res.reply('success')

  /**
   * 有错误返回错误，不然微信会在一段时间里以一定频次请求你
   * res.reply(new Error('...'))
   */
}))
```

## 发红包

```javascript
payment.sendRedPacket({
  mch_billno: 'kfc002',
  send_name: '肯德基',
  re_openid: '',
  total_amount: 10 * 100,
  total_num: 1,
  wishing: '祝多多吃鸡',
  client_ip: '',
  act_name: '吃鸡大奖赛',
  remark: '记得吐骨头',
  scene_id: 'PRODUCT_1'
}, (err, result) => {
  /**
   * 微信收到正确的请求后会给用户发红包，用户不必关注公众号也能收到。
   * 红包没有通知回调，有需要的话标记订单状态，和有err的时候记录一下以便排查
   */
  })
})
```

### 查询红包状态

```javascript
payment.redPacketQuery({
  mch_billno: 'kfc002'
}, (err, result) => {
  /**
   * 根据状态相应处理订单
   */
})
```

## 企业付款

```javascript
payment.transfers({
  partner_trade_no: 'kfc003',
  openid: '',
  check_name: 'NO_CHECK',
  amount: 10 * 100,
  desc: '',
  spbill_create_ip: ''
}, (err, result) => {
  // 根据微信文档，当返回错误码为“SYSTEMERROR”时，一定要使用原单号重试，否则可能造成重复支付等资金风险。
})
```

## 查询历史订单

```javascript
payment.downloadBill({
  bill_date: '20140913',
  bill_type: 'ALL'
}, function(err, data){
  // 账单列表
  var list = data.list
  // 账单统计信息
  var stat = data.stat
})
```

## 错误处理

在回调的Error上的以name做了区分，有需要可以拿来做判断

* ProtocolError 协议错误，看看有没有必须要传的参数没传
* BusinessError 业务错误，可以从返回的data里面看看错误细节
