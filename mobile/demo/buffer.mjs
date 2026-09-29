// The `buffer` package lacks Node's 'base64url' encoding, which the mock uses (VAPID key, push subscriptions).
import { Buffer } from 'buffer'

const from = Buffer.from
Buffer.from = function (value, encoding, length) {
  if (encoding !== 'base64url') return from.call(Buffer, value, encoding, length)
  return from.call(Buffer, value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}
const toString = Buffer.prototype.toString
Buffer.prototype.toString = function (encoding, start, end) {
  if (encoding !== 'base64url') return toString.call(this, encoding, start, end)
  return toString.call(this, 'base64', start, end).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export { Buffer }
