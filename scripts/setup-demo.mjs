import { randomBytes } from 'node:crypto'
import { writeFile, access } from 'node:fs/promises'
try {
  await access('.env')
  console.log('.env existe deja : cle conservee pour les deux instances.')
} catch {
  await writeFile('.env', `JWT_SECRET=${randomBytes(48).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' })
  console.log('.env cree (non versionne). Vous pouvez lancer docker compose up --build -d --wait.')
}
