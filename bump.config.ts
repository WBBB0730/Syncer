import { defineConfig } from 'bumpp'

export default defineConfig({
  files: [
    'package.json',
    'syncer-desktop/package.json',
    'syncer-mobile/package.json',
    'syncer-mobile/app.json'
  ],
  commit: 'chore(release): v%s',
  tag: 'v%s',
  push: true
})
