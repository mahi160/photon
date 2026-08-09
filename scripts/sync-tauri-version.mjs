#!/usr/bin/env node
// semantic-release's @semantic-release/npm plugin bumps package.json's
// version; it has no idea src-tauri/tauri.conf.json and src-tauri/Cargo.toml
// carry their own separate `version` fields (what the actual shipped Tauri
// binary/updater report -- package.json's version is otherwise unused at
// runtime). Run as .releaserc.json's @semantic-release/exec `prepareCmd`,
// after npm's prepare step, before @semantic-release/git commits its
// configured assets.
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('usage: sync-tauri-version.mjs <version>')
  process.exit(1)
}

const confPath = 'src-tauri/tauri.conf.json'
const conf = JSON.parse(readFileSync(confPath, 'utf8'))
conf.version = version
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')

// Only the [package] table's own `version = "..."` line -- not any
// [dependencies]/[target...dependencies] entry that also happens to pin a
// `version = "..."`. [package] is always the first table in this file.
const cargoPath = 'src-tauri/Cargo.toml'
const cargo = readFileSync(cargoPath, 'utf8')
const versionLine = /(\[package\][^[]*?\nversion = )"[^"]*"/
// Match presence, not a before/after diff -- re-running with the version Cargo.toml already has
// (e.g. a manually-recovered release re-cutting the same pre.N) is a legitimate no-op, not a failure.
if (!versionLine.test(cargo)) {
  console.error(`could not find [package] version in ${cargoPath}`)
  process.exit(1)
}
writeFileSync(cargoPath, cargo.replace(versionLine, `$1"${version}"`))

console.log(`synced ${confPath} and ${cargoPath} to ${version}`)
