import test from "node:test";
import assert from "node:assert/strict";
import { uninstallCommands } from "./installer-uninstall.mjs";

test("uninstaller removes only listed files and empty directories", () => {
  const commands = uninstallCommands([
    "Vibe Remote Buddy.exe",
    "build-info.json",
    "resources/catalog/catalog.json",
    "resources/remotes/xiaomi.rc003/model.json",
  ]);
  assert.match(commands, /Delete "\$INSTDIR\\Vibe Remote Buddy\.exe"/);
  assert.match(commands, /IfFileExists "\$INSTDIR\\resources\\remotes\\xiaomi\.rc003\\user-edited" \+2 0\n  Delete/);
  assert.match(commands, /RMDir "\$INSTDIR\\resources\\catalog"/);
  assert.doesNotMatch(commands, /RMDir\s+\/r|\$INSTDIR\\\*|Delete "\$INSTDIR"/i);
  assert.ok(commands.indexOf('RMDir "$INSTDIR\\resources\\catalog"') <
    commands.indexOf('RMDir "$INSTDIR\\resources"'));
});

test("uninstaller rejects paths that could inject commands or escape the install tree", () => {
  for (const name of ["../outside", "C:/outside", "a\\outside", "a/$R0", 'a/"\nRMDir', "a/../b", "a//b"])
    assert.throws(() => uninstallCommands([name]), /Unsafe/);
  assert.throws(() => uninstallCommands(["x.txt", "X.txt"]), /duplicate/);
});
