import jwt from 'jsonwebtoken'
import { SECRET } from './security-helpers.ts'

console.log(jwt.sign({ sub: 'demo-user' }, SECRET, { expiresIn: '4h' }))
