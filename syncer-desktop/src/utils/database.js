import sqlite3 from 'sqlite3'
import { open } from 'sqlite'

(async () => {
  const db = await open({
    filename: '/tmp/database.db',
    driver: sqlite3.cached.Database
  })
  await db.exec('CREATE TABLE IF NOT EXISTS config (id )')
})()

async function setConfig() {
  const db = await open({
    filename: '/database.db',
    driver: sqlite3.cached.Database
  })
}

async function getConfig(key) {

}
