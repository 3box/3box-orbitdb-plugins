const ensureAddress = require('orbit-db-access-controllers/src/utils/ensure-ac-address')
const EventEmitter = require('events').EventEmitter
const entryIPFS = require('ipfs-log/src/entry')
const isIPFS = require('is-ipfs')

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
  }

  static get type () { return type }

  // return addres of AC (in this case orbitdb address of AC)
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

  _updateCapabilites () {
    let moderators = [], members = []
    if (this._db) {
      moderators.push(this._db.access._firstModerator)
      Object.entries(this._db.index).forEach(entry => {
        const capability = entry[1].payload.value.capability
        const id = entry[1].payload.value.id
        if (capability === MODERATOR) moderators.push(id)
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
    if (this._db) { await this._db.close() }

    // TODO - skip manifest for mod-access
    this._db = await this._orbitdb.feed(ensureAddress(address), {
      identity: this._identity,
      accessController: {
        type: 'moderator-access',
        firstModerator: this._firstModerator,
        members: this._members
      },
      sync: true
    })

    this._db.events.on('ready', this._onUpdate.bind(this))
    this._db.events.on('write', this._onUpdate.bind(this))
    this._db.events.on('replicated', this._onUpdate.bind(this))

    await this._db.load()
  }

  async save () {
    return {
      address: this._db.address.toString(),
      firstModerator: this._firstModerator,
      members: this._members
    }
  }

  async grant (capability, id) {
    if (!this._db.access.isValidCapability(capability)) {
      throw new Error('grant: Invalid capability to grant')
    }
    if (capability === MEMBER && this.capabilities['members'].includes(id)) {
        throw new Error(`grant: capability ${capability} has already been granted to ${id}`)
    }
    if (capability === MODERATOR && this.capabilities['moderators'].includes(id)) {
        throw new Error(`grant: capability ${capability} has already been granted to ${id}`)
    }
    try {
      await this._db.add({capability, id})
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
    const ac = new ThreadAccessController(orbitdb, orbitdb._ipfs, options.identity, options.firstModerator, options)
    await ac.load(options.address || options.threadName)
    return ac
  }
}

module.exports = ThreadAccessController
