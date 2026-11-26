#!/usr/bin/env node
/**
 * T-206: stops an iPhone build that would be made without the room scanner.
 *
 * The first App Store build (1.0.0, build 2) had no room scan: the scanner's
 * Swift source and podspec were kept out of git by an ignore line, so the
 * build service never received them, and Expo quietly linked every module
 * except ours. Nothing failed; the app said "Room scan needs the full app".
 *
 * The build service runs this after `npm install`, `expo prebuild` and
 * `pod install` (the `eas-build-post-install` script in package.json), before
 * anything is compiled. It looks at three things, in the order they depend on
 * each other, and names the first that is wrong:
 *
 *   1. the scanner's native source is in the folder that was sent;
 *   2. CocoaPods installed its pod (Podfile.lock);
 *   3. Expo lists its module among the ones the app loads
 *      (ExpoModulesProvider.swift). That file is compiled into the app and
 *      names `RoomScanModule` directly, so an app that builds with it has it.
 *
 * A second check runs inside the Xcode build itself, on the finished binary
 * (plugins/with-room-scan-linked.js).
 *
 * By hand, after a prebuild and a pod install:  node scripts/check-room-scan.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const POD = 'RoomScan'
export const MODULE_CLASS = 'RoomScanModule'

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null)
const list = (dir) => (existsSync(dir) ? readdirSync(dir) : [])

/** What is wrong with the scanner in the app folder `appDir`, in plain words; empty when nothing is */
export function roomScanProblems(appDir) {
  const source = join(appDir, 'modules', 'room-scan', 'ios')
  if (!existsSync(join(source, `${POD}.podspec`)) || !list(source).some((name) => name.endsWith('.swift'))) {
    return [
      `The scanner's native source is not here: modules/room-scan/ios needs ${POD}.podspec and its Swift file.`,
      'The build service receives what git has, less what .gitignore leaves out: make sure both files are committed and not ignored.',
    ]
  }

  const lock = read(join(appDir, 'ios', 'Podfile.lock'))
  if (lock === null) return ['There is no ios/Podfile.lock: run this after `expo prebuild` and `pod install`.']
  if (!new RegExp(`^  - ${POD} \\(`, 'm').test(lock)) {
    return [`CocoaPods did not install the ${POD} pod (it is not in ios/Podfile.lock), so Expo did not find modules/room-scan.`]
  }

  const support = join(appDir, 'ios', 'Pods', 'Target Support Files')
  const providers = list(support)
    .map((target) => join(support, target, 'ExpoModulesProvider.swift'))
    .filter((file) => existsSync(file))
  if (providers.length === 0) return ['Expo wrote no ExpoModulesProvider.swift under ios/Pods/Target Support Files.']
  const missing = providers.filter((file) => !readFileSync(file, 'utf8').includes(`${MODULE_CLASS}.self`))
  if (missing.length > 0) return [`Expo's list of modules does not name ${MODULE_CLASS}: ${missing.join(', ')}`]

  return []
}

const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (runDirectly) {
  const platform = process.env.EAS_BUILD_PLATFORM
  if (platform && platform !== 'ios') {
    console.log(`Room scanner check: nothing to check on ${platform} (the scanner is iPhone only).`)
    process.exit(0)
  }
  const appDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const problems = roomScanProblems(appDir)
  if (problems.length > 0) {
    console.error('\nROOM SCANNER MISSING: this build is stopped, because the app it made would have no room scan.\n')
    for (const line of problems) console.error(`  ${line}`)
    console.error('')
    process.exit(1)
  }
  console.log(`Room scanner check: ${POD} is installed and ${MODULE_CLASS} is in Expo's list of modules.`)
}
