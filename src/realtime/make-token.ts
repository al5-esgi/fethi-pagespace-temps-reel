import { findDemoProfile } from '../profiles.ts'
import { signAccessToken } from './security-helpers.ts'

if (!process.env.JWT_SECRET) throw new Error('Definir JWT_SECRET, identique au serveur, pour generer un jeton CLI')

const profileId = process.argv[2] ?? 'demo-user'
if (!findDemoProfile(profileId)) throw new Error(`profil inconnu : ${profileId}`)
console.log(signAccessToken(profileId))
