const ensureAddress = require('orbit-db-access-controllers/src/utils/ensure-ac-address')
const EventEmitter = require('events').EventEmitter
const entryIPFS = require('ipfs-log/src/entry')
const isIPFS = require('is-ipfs')
const orbitAddress = require('orbit-db/src/orbit-db-address')

const type = 'thread-access'
const MODERATOR = 'MODERATOR'
const MEMBER = 'MEMBER'

const isValid3ID = did => {
  const parts = did.split(':')
  if (!parts[0] === 'did' || !parts[1] === '3') return false
  return isIPFS.cid(parts[2])
}

class ThreadAccessController extends EventEmitter{
  constructor (orbitdb, ipfs, identity, firstModerator, options) {
    super()
    this._orbitdb = orbitdb
    this._db = null
    this._options = options || {}
    this._ipfs = ipfs
    this._members = Boolean(options.members)
    this._firstModerator = firstModerator
    this._threadName = options.threadName
    this._identity = identity
    this._encKeyId = options.encKeyId
  }

  static get type () { return type }

  // return address of AC (in this case orbitdb address of AC)
  get address () {
    return this._db.address
  }

  async canAppend (entry, identityProvider) {
    const trueIfValidSig = async () => await identityProvider.verifyIdentity(entry.identity)

    const op = entry.payload.op
    const mods = this.capabilities['moderators']
    const members = this.capabilities['members']
    const isMod = mods.includes(entry.identity.id)
    const isMember = members.includes(entry.identity.id)

    if (op === 'ADD') {
      // Anyone can add entry if open thread
      if (!this._members) return await trueIfValidSig()
      // Not open thread, any member or mod can add to thread
      if (isMember || isMod) return await trueIfValidSig()
    }

    if (op === 'DEL') {
      const hash = entry.payload.value
      const delEntry = await entryIPFS.fromMultihash(this._ipfs, hash)

      // An id can delete their own entries
      if (delEntry.identity.id === entry.identity.id) return await trueIfValidSig()

      // Mods can delete any entry
      if (isMod) return await trueIfValidSig()
    }

    return false
  }

  get capabilities () {
    if (!this._capabilities) this._updateCapabilites()
    return this._capabilities
  }

  getEncryptedKey (did) {
    if (!this._encKeyId) throw new Error(`getEncryptedKey: only available for confidential threads`)
    const didEntries = Object.entries(this._db.index).map(entry => {
      return {
        id: entry[1].payload.value.id,
        encryptedReadKey: entry[1].payload.value.encryptedReadKey
      }
    }).filter(entry => {
      return entry.id === did
    })

    if (didEntries.length === 0 ) throw new Error(`getEncryptedKey: no access for ${did}`)
    return didEntries[0].encryptedReadKey
  }

  _updateCapabilites () {
    let moderators = [], members = []
    if (this._db) {
      moderators.push(this._db.access._firstModerator)
      Object.entries(this._db.index).forEach(entry => {
        const capability = entry[1].payload.value.capability
        const id = entry[1].payload.value.id
        if (capability === MODERATOR) {
          if (!moderators.includes(id)) moderators.push(id)
        }
        if (capability === MEMBER) members.push(id)
      })
    }
    this._capabilities = {moderators, members}
    return this._capabilities
  }

  get (capability) {
    return this.capabilities[capability] || []
  }

  async close () {
    await this._db.close()
  }

  async load (address) {
    const isAddress = orbitAddress.isValid(address)
    if (this._db) { await this._db.close() }

    // TODO - skip manifest for mod-access
    this._db = await this._orbitdb.feed(ensureAddress(address), this._createOrbitOpts(isAddress))

    this._db.events.on('ready', this._onUpdate.bind(this))
    this._db.events.on('write', this._onUpdate.bind(this))
    this._db.events.on('replicated', this._onUpdate.bind(this))

    await this._db.load()
  }

  _createOrbitOpts(loadByAddress = false) {
    const accessController = {
      type: 'moderator-access',
      firstModerator: this._firstModerator,
      members: this._members,
      encKeyId: this._encKeyId
    }

    const opts = {
      identity: this._identity,
      sync: true
    }

    return Object.assign(opts, loadByAddress ? {} : { accessController })
  }

  async save () {
    const address = await this._orbitdb.determineAddress(`${this._threadName}/_access`, 'feed', this._createOrbitOpts())

    const manifest = {
      address: address.toString(),
      firstModerator: this._firstModerator,
      members: this._members
    }
    if (this._encKeyId) manifest.encKeyId = this._encKeyId
    return manifest
  }

  async grant (capability, id, encryptedReadKey) {
    if (!this._db.access.isValidCapability(capability)) {
      throw new Error('grant: Invalid capability to grant')
    }
    if (capability === MEMBER && this.capabilities['members'].includes(id)) {
        throw new Error(`grant: capability ${capability} has already been granted to ${id}`)
    }
    // length 1 allows first mod to add entry with encryptedReadKey
    if (capability === MODERATOR && this.capabilities['moderators'].includes(id) && this.capabilities['moderators'].length !== 1) {
        throw new Error(`grant: capability ${capability} has already been granted to ${id}`)
    }
    if (this._encKeyId && !encryptedReadKey) {
      throw new Error('grant: confidential threads require access to be granted with encrypted key')
    }
    try {
      const entry = {capability, id}
      if (encryptedReadKey) entry.encryptedReadKey = encryptedReadKey
      await this._db.add(entry)
    } catch (e) {
      if (e.toString().includes('not append entry')) throw new Error(`grant: Capability ${capability} can not be granted to ${id}`)
      throw e
    }
  }

  _onUpdate () {
    this._updateCapabilites()
    this.emit('updated')
  }

  /* Factory */
  static async create (orbitdb, options = {}) {
    if (!options.firstModerator) throw new Error('Thread AC: firstModerator required')
    if (options.address) options.threadName = options.address.split('/')[3]
    return new ThreadAccessController(orbitdb, orbitdb._ipfs, options.identity, options.firstModerator, options)
  }
}

module.exports = ThreadAccessController
