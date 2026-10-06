import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

await mkdir(new URL('../public/vendor/', import.meta.url), { recursive: true })
await writeFile(new URL('../public/vendor/socket.io.min.js', import.meta.url),
  await readFile(new URL('../node_modules/socket.io-client/dist/socket.io.min.js', import.meta.url)))

const output = new URL('../public/realtime/', import.meta.url)
await mkdir(output, { recursive: true })
for (const file of ['convergence.exemple', 'document-crdt']) {
  const source = await readFile(new URL(`../src/realtime/${file}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    fileName: `${file}.ts`,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
      rewriteRelativeImportExtensions: true },
  })
  await writeFile(new URL(`${file}.js`, output), '// Genere par npm run build:client. Source : src/realtime/\n' + outputText)
}
console.log(`CRDT navigateur genere dans ${fileURLToPath(output)}`)
