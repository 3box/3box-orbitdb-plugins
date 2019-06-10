const type = 'moderator-access'

const MODERATOR = 'MODERATOR'
const MEMBER = 'MEMBER'

class ModeratorAccessController {
  constructor (firstModerator, options) {
    this._capabilityTypes = [MODERATOR]
    this._write = []     // Allowed to add other mods or members
    this._firstModerator = firstModerator
    this._write.push(this._firstModerator)
    this._members = Boolean(options.members)
    if (this._members) this._capabilityTypes.push(MEMBER)
  }

  static get type () { return type }

  isMod(id) {
    return this._write.includes(id)
  }

  isValidCapability (capability) {
    return this._capabilityTypes.includes(capability)
  }

  get firstModerator () {
    return this._firstModerator
  }

  async canAppend (entry, identityProvider) {
    const entryID = entry.identity.id
    const capability = entry.payload.value.capability
    const idAdd = entry.payload.value.id
    const isMod = this.isMod(entryID)
    const validCapability = this.isValidCapability(capability)
    const validSig = async () => identityProvider.verifyIdentity(entry.identity)
    if (isMod && validCapability && (await validSig())) {
      if (capability === MODERATOR) this._write.push(idAdd)
      return true
    }

    return false
  }

  async load (address) {
    const addList = address.split('/')
    const suffix = addList.pop()
    this._members = suffix === 'members'
    const mod = suffix.includes('mod') ? suffix : addList.pop()
    this._firstModerator = mod.split('_')[1]
  }

  async save () {
    // TODO if entire obj saved in manfest, can just pass our own fields
    let address = `${type}/mod_${this._firstModerator}`
    address += this._members ? '/members' : ''
    return { address }
  }

  static async create (orbitdb, options = {}) {
    if (!options.firstModerator) throw new Error('Moderator AC: firstModerator required')
    return new ModeratorAccessController(options.firstModerator, options)
  }
}

module.exports = ModeratorAccessController
