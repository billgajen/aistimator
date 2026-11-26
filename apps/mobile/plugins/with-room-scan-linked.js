/**
 * T-206: the iPhone build fails when the room scanner is not in the app it made.
 *
 * Expo links the native modules it finds and says nothing about one it does
 * not find. The first App Store build was made without ours (its source was
 * never sent to the build service) and nothing failed: the app said "Room
 * scan needs the full app" on a reviewer's phone.
 *
 * This adds one last step to the Xcode build of the app: it reads the binary
 * that was just linked and stops the build when the scanner's class is not
 * in it. It runs for a build for a real iPhone in Release, which is what the
 * store build and the build onto the owner's phone are. A simulator build
 * and a Debug build are left alone (a Debug build keeps its code in a
 * second file).
 *
 * The earlier, quicker check is scripts/check-room-scan.mjs.
 */
const { withXcodeProject } = require('expo/config-plugins')

const PHASE = 'Check the room scanner is linked'
const MODULE_CLASS = 'RoomScanModule'

const SCRIPT = [
  '# T-206 (plugins/with-room-scan-linked.js): a store build without the room scanner must not be made',
  'if [ "$CONFIGURATION" != "Release" ] || [ "$PLATFORM_NAME" != "iphoneos" ]; then',
  '  echo "Room scanner check: skipped for $CONFIGURATION on $PLATFORM_NAME"',
  '  exit 0',
  'fi',
  'BINARY="$TARGET_BUILD_DIR/$EXECUTABLE_PATH"',
  `if LC_ALL=C grep -q "${MODULE_CLASS}" "$BINARY"; then`,
  `  echo "Room scanner check: ${MODULE_CLASS} is linked into $EXECUTABLE_NAME"`,
  'else',
  `  echo "error: ROOM SCANNER MISSING: ${MODULE_CLASS} is not in $EXECUTABLE_NAME. The app would say Room scan needs the full app. Check that modules/room-scan/ios is committed to git and not ignored."`,
  '  exit 1',
  'fi',
  '',
].join('\n')

/** The change itself, on the Xcode project as Expo hands it over (kept apart so a test can run it) */
function addCheck(project) {
  const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {}
  const there = Object.values(phases).some((phase) => phase && typeof phase === 'object' && phase.name === `"${PHASE}"`)
  if (there) return project
  project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE, project.getFirstTarget().uuid, {
    shellPath: '/bin/sh',
    shellScript: SCRIPT,
    // Read after the app is linked: the binary is this step's input
    inputPaths: ['"$(TARGET_BUILD_DIR)/$(EXECUTABLE_PATH)"'],
  })
  return project
}

module.exports = function withRoomScanLinked(config) {
  return withXcodeProject(config, (mod) => {
    mod.modResults = addCheck(mod.modResults)
    return mod
  })
}

module.exports.PHASE = PHASE
module.exports.SCRIPT = SCRIPT
module.exports.addCheck = addCheck
