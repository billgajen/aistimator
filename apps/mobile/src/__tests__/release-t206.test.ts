/**
 * T-206: the store build carries the room scanner, and an iPad is called an iPad.
 *
 * The first App Store build had no room scan. The scanner's Swift source and podspec were never
 * in git (an ignore line meant for the generated `ios` folder also matched `modules/room-scan/ios`),
 * so the build service never received them, and Expo linked every module except ours without a
 * word. These tests hold the three things that stop that happening again: the files are in git,
 * the build service's hook stops a build without them, and the Xcode build stops when the scanner
 * is not in the binary it linked.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deviceWord, forDevice } from '../lib/device'
import { roomScanProblems } from '../../scripts/check-room-scan.mjs'

const APP = join(__dirname, '../..')
const read = (path: string) => readFileSync(join(APP, path), 'utf8')
const require = createRequire(import.meta.url)
const NATIVE = ['modules/room-scan/ios/RoomScan.podspec', 'modules/room-scan/ios/RoomScanModule.swift']
const problems = roomScanProblems as (appDir: string) => string[]

/** Runs git in the app folder; the exit code and what it printed */
const git = (...args: string[]) => {
  const done = spawnSync('git', args, { cwd: APP, encoding: 'utf8' })
  return { status: done.status, out: done.stdout.trim() }
}

describe('T-206: the scanner’s native source reaches the build service', () => {
  it('both files are in git', () => {
    expect(git('ls-files', '--', ...NATIVE).out.split('\n').sort()).toEqual(NATIVE)
  })

  it('no ignore line matches them, and every other part of the module is in git too', () => {
    // git answers 1 when nothing ignores the path
    for (const file of [...NATIVE, 'modules/room-scan/index.ts', 'modules/room-scan/expo-module.config.json']) {
      expect(git('check-ignore', '-q', '--no-index', file).status, file).toBe(1)
    }
  })

  it('the generated native projects are ignored at the app’s top only', () => {
    const lines = read('.gitignore').split('\n').map((line) => line.trim())
    expect(lines).toContain('/ios/')
    expect(lines).toContain('/android/')
    // without the leading slash these match a folder of that name at any depth
    expect(lines).not.toContain('ios/')
    expect(lines).not.toContain('android/')
    expect(git('check-ignore', '-q', '--no-index', 'ios/Podfile').status).toBe(0)
  })

  it('the module names its Swift class to Expo, and the podspec compiles the Swift beside it', () => {
    const config = JSON.parse(read('modules/room-scan/expo-module.config.json')) as { platforms: string[]; apple: { modules: string[] } }
    expect(config.platforms).toContain('apple')
    expect(config.apple.modules).toEqual(['RoomScanModule'])
    expect(read(NATIVE[1]!)).toMatch(/public class RoomScanModule: Module/)
    expect(read(NATIVE[1]!)).toContain('Name("RoomScan")')
    expect(read(NATIVE[0]!)).toMatch(/s\.name\s*=\s*'RoomScan'/)
    expect(read(NATIVE[0]!)).toContain("s.source_files = '**/*.swift'")
  })

  it('the app asks for the camera in words that name the scan (RoomPlan needs no entitlement)', () => {
    const app = JSON.parse(read('app.json')).expo as { ios: { infoPlist: Record<string, unknown> } }
    expect(String(app.ios.infoPlist.NSCameraUsageDescription)).toMatch(/scan a room/)
  })
})

describe('T-206: the build service stops an iPhone build that has no scanner', () => {
  /** An app folder as it is after `expo prebuild` and `pod install`, with the parts asked for */
  const folder = (parts: { source?: boolean; lock?: string | null; provider?: string | null }) => {
    const dir = mkdtempSync(join(tmpdir(), 't206-'))
    if (parts.source !== false) {
      mkdirSync(join(dir, 'modules/room-scan/ios'), { recursive: true })
      writeFileSync(join(dir, 'modules/room-scan/ios/RoomScan.podspec'), '')
      writeFileSync(join(dir, 'modules/room-scan/ios/RoomScanModule.swift'), '')
    }
    if (parts.lock !== null) {
      mkdirSync(join(dir, 'ios'), { recursive: true })
      writeFileSync(join(dir, 'ios/Podfile.lock'), parts.lock ?? 'PODS:\n  - Expo (58.0.0):\n  - RoomScan (0.1.0):\n    - ExpoModulesCore\n')
    }
    if (parts.provider !== null) {
      mkdirSync(join(dir, 'ios/Pods/Target Support Files/Pods-Qolumns'), { recursive: true })
      writeFileSync(join(dir, 'ios/Pods/Target Support Files/Pods-Qolumns/ExpoModulesProvider.swift'), parts.provider ?? 'internal import RoomScan\n      (module: RoomScanModule.self, name: nil)\n')
    }
    return dir
  }

  it('the hook is the script, run after the pods are installed', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    expect(scripts['eas-build-post-install']).toBe('node scripts/check-room-scan.mjs')
  })

  it('a folder with the source, the pod and the module in Expo’s list passes', () => {
    expect(problems(folder({}))).toEqual([])
  })

  it('what the first store build was sent (no native source) is stopped, and the reason names git', () => {
    const found = problems(folder({ source: false }))
    expect(found[0]).toMatch(/native source is not here/)
    expect(found.join(' ')).toMatch(/committed and not ignored/)
  })

  it('a pod that was not installed is stopped', () => {
    expect(problems(folder({ lock: 'PODS:\n  - Expo (58.0.0):\n  - RoomScanner (1.0.0):\n' }))[0]).toMatch(/did not install the RoomScan pod/)
  })

  it('a module missing from Expo’s list is stopped', () => {
    expect(problems(folder({ provider: 'internal import ExpoFont\n      (module: FontLoaderModule.self, name: nil)\n' }))[0]).toMatch(/does not name RoomScanModule/)
    expect(problems(folder({ provider: null }))[0]).toMatch(/no ExpoModulesProvider/)
  })

  it('run before the pods are installed, it says so instead of passing', () => {
    expect(problems(folder({ lock: null, provider: null }))[0]).toMatch(/no ios\/Podfile.lock/)
  })

  it('run as the build service runs it for Android: nothing to check, the build goes on', () => {
    const script = join(APP, 'scripts/check-room-scan.mjs')
    const android = spawnSync('node', [script], { encoding: 'utf8', env: { ...process.env, EAS_BUILD_PLATFORM: 'android' } })
    expect(android.status).toBe(0)
    expect(android.stdout).toMatch(/nothing to check on android/)
  })
})

describe('T-206: the Xcode build stops when the scanner is not in the binary', () => {
  const plugin = require(join(APP, 'plugins/with-room-scan-linked.js')) as { PHASE: string; SCRIPT: string; addCheck: (project: unknown) => unknown }

  /** Runs the step's own script as Xcode does, against a file standing in for the app's binary */
  const runStep = (binary: string, configuration: string, platform: string) => {
    const dir = mkdtempSync(join(tmpdir(), 't206-bin-'))
    writeFileSync(join(dir, 'Qolumns'), binary)
    return spawnSync('/bin/sh', ['-c', plugin.SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, CONFIGURATION: configuration, PLATFORM_NAME: platform, TARGET_BUILD_DIR: dir, EXECUTABLE_PATH: 'Qolumns', EXECUTABLE_NAME: 'Qolumns' },
    })
  }

  it('the app’s settings name the plugin', () => {
    const app = JSON.parse(read('app.json')).expo as { plugins: unknown[] }
    expect(app.plugins).toContain('./plugins/with-room-scan-linked')
  })

  it('a Release build for an iPhone with the scanner’s class in it passes', () => {
    const done = runStep('\u0000\u0001_$s8RoomScan0aB6ModuleCN\u0000RoomScanModule\u0000', 'Release', 'iphoneos')
    expect(done.status).toBe(0)
    expect(done.stdout).toMatch(/RoomScanModule is linked into Qolumns/)
  })

  it('one without it fails, with a line Xcode shows as an error', () => {
    const done = runStep('\u0000\u0001ExpoFontLoader\u0000FontLoaderModule\u0000', 'Release', 'iphoneos')
    expect(done.status).toBe(1)
    expect(done.stdout).toMatch(/^error: ROOM SCANNER MISSING/m)
  })

  it('a simulator build and a Debug build are left alone', () => {
    expect(runStep('nothing', 'Release', 'iphonesimulator').status).toBe(0)
    expect(runStep('nothing', 'Debug', 'iphoneos').status).toBe(0)
  })

  it('the step is added to the app’s target once, however often the project is generated', () => {
    const added: Array<{ name: string; target: string; options: { shellScript: string; inputPaths: string[] } }> = []
    const project = {
      hash: { project: { objects: { PBXShellScriptBuildPhase: {} as Record<string, unknown> } } },
      getFirstTarget: () => ({ uuid: 'TARGET' }),
      addBuildPhase(_files: string[], type: string, name: string, target: string, options: { shellScript: string; inputPaths: string[] }) {
        added.push({ name, target, options })
        this.hash.project.objects.PBXShellScriptBuildPhase[`ID${added.length}`] = { isa: type, name: `"${name}"` }
      },
    }
    plugin.addCheck(project)
    plugin.addCheck(project)
    expect(added).toHaveLength(1)
    expect(added[0]!.name).toBe(plugin.PHASE)
    expect(added[0]!.target).toBe('TARGET')
    // it reads the linked binary, so it is ordered after the link
    expect(added[0]!.options.inputPaths[0]).toContain('$(TARGET_BUILD_DIR)/$(EXECUTABLE_PATH)')
  })
})

describe('T-206 item 4: an iPad is called an iPad on the Quotes screen', () => {
  it('"iPad" on an iPad, "phone" on an iPhone and on Android', () => {
    expect(deviceWord('ios', true)).toBe('iPad')
    expect(deviceWord('ios', false)).toBe('phone')
    expect(deviceWord('android', false)).toBe('phone')
    expect(deviceWord('android', true)).toBe('phone')
  })

  it('a line written for a phone is said for the iPad, and left alone on a phone', () => {
    expect(forDevice('No signal. Saved on this phone. It sends by itself when you are back online.', 'iPad')).toBe('No signal. Saved on this iPad. It sends by itself when you are back online.')
    expect(forDevice('Saved on this phone.', 'phone')).toBe('Saved on this phone.')
    expect(forDevice('Sending the job', 'iPad')).toBe('Sending the job')
  })

  it('the Quotes screen uses it for the heading, the unfinished quote and a quote waiting to send', () => {
    const screen = read('app/(tabs)/index.tsx')
    expect(screen).toContain("deviceWord(Platform.OS, Platform.OS === 'ios' && Platform.isPad)")
    expect(screen).toContain('title={`On this ${DEVICE}`}')
    expect(screen).toContain('saved on this {DEVICE}. Tap to carry on.')
    expect(screen).toContain('Saved on this ${DEVICE}. Carry on')
    expect(screen).toMatch(/const line = forDevice\(/)
    expect(screen).not.toMatch(/[Oo]n this phone[".<]/)
  })
})

/** The whole check, as a person would run it: `git` knows the files this build would send */
describe('T-206: what git would hand the build service', () => {
  it('lists the scanner’s four files under modules/room-scan', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'modules/room-scan'], { cwd: APP, encoding: 'utf8' }).trim().split('\n').sort()
    expect(tracked).toEqual(['modules/room-scan/expo-module.config.json', 'modules/room-scan/index.ts', ...NATIVE].sort())
  })
})
