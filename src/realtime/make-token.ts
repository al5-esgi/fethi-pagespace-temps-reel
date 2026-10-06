import jwt from 'jsonwebtoken'
import { findDemoProfile } from '../profiles.ts'
import { SECRET } from './security-helpers.ts'

const profileId = process.argv[2] ?? 'demo-user'
if (!findDemoProfile(profileId)) throw new Error(`profil inconnu : ${profileId}`)
console.log(jwt.sign({ sub: profileId }, SECRET, { expiresIn: '4h' }))
