const base64url = require('base64url')
const { verifyJWT } = require('did-jwt')

const encodeSection = data => base64url.encode(JSON.stringify(data))

const TYPE = '3ID'
const JWT_HEADER = encodeSection({ typ: 'JWT', alg: 'ES256K' })


class OdbIdentityProvider {
  constructor ({ threeId }) {
    // super(options)
    this.threeId = threeId
  }

  static get type () {
    return '3ID'
  }

  async getId ({ space }) {
    if (space) {
      return this.threeId.getSubDID(space)
    } else {
      return this.threeId.DID
    }
  }

  async signIdentity (data, { space }) {
    const payload = {
      data,
      iat: null
    }
    const opts = !space ? { use3ID: true } : { space }
    return (await this.threeId.signJWT(payload, opts)).split('.')[2]
  }

  static async verifyIdentity (identity) {
    const payload = encodeSection({
      iat: null,
      data: identity.publicKey + identity.signatures.id,
      iss: identity.id
    })
    const jwt = `${JWT_HEADER}.${payload}.${identity.signatures.publicKey}`
    try {
      await verifyJWT(jwt, { auth: true })
    } catch (e) {
      return false
    }
    return true
   }
}

module.exports = OdbIdentityProvider
