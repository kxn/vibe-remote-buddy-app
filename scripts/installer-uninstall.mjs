// Generate NSIS uninstall commands from the files actually packaged.
// Never recursively delete $INSTDIR: a user can install into a shared folder.
export function uninstallCommands(files) {
  const seen = new Set();
  const directories = new Set();
  const commands = [];
  for (const rel of [...files].sort()) {
    if (
      typeof rel !== "string" ||
      !/^[A-Za-z0-9_ .\/-]+$/.test(rel) ||
      rel.startsWith("/") ||
      rel.split("/").some((part) =>
        !part || part === "." || part === ".." || part.endsWith(" ") || part.endsWith(".")) ||
      seen.has(rel.toLowerCase())
    ) throw Error(`Unsafe or duplicate installer path: ${rel}`);
    seen.add(rel.toLowerCase());
    const win = rel.replaceAll("/", "\\");
    const model = /^resources\/remotes\/([^/]+)\//.exec(rel);
    if (model) {
      commands.push(`  IfFileExists "$INSTDIR\\resources\\remotes\\${model[1]}\\user-edited" +2 0`);
    }
    commands.push(`  Delete "$INSTDIR\\${win}"`);
    const parts = rel.split("/");
    parts.pop();
    while (parts.length) {
      directories.add(parts.join("\\"));
      parts.pop();
    }
  }
  for (const dir of [...directories].sort((a, b) =>
    b.split("\\").length - a.split("\\").length || b.localeCompare(a))) {
    commands.push(`  RMDir "$INSTDIR\\${dir}"`);
  }
  return commands.join("\n") + "\n";
}
