import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function renderUserGuide(destination) {
  const source = fs.readFileSync(path.join(root, "docs/user-guide.md"), "utf8");
  const imagePaths = [
    ...source.matchAll(/!\[[^\]]*\]\((images\/user-guide\/[^)]+)\)/g),
  ].map((match) => match[1]);
  for (const imagePath of imagePaths)
    if (!fs.existsSync(path.join(root, "docs", imagePath)))
      throw new Error(`User guide image is missing: ${imagePath}`);

  const body = marked.parse(source).replace(
    /<h([1-6])>(.*?)<\/h\1>/gs,
    (_, level, title) => {
      const id = title
        .replace(/<[^>]*>/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N} -]/gu, "")
        .trim()
        .replace(/ +/g, "-");
      return `<h${level} id="${id}">${title}</h${level}>`;
    },
  );
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vibe Remote Buddy 使用说明</title>
<style>
  :root { color-scheme: light; font-family: "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; color: #26221f; background: #f8f5ef; }
  body { max-width: 840px; margin: 0 auto; padding: 28px 22px 80px; line-height: 1.75; }
  h1, h2 { line-height: 1.35; }
  h1 { margin-bottom: 8px; }
  h2 { margin-top: 48px; padding-top: 8px; border-top: 1px solid #ded6ca; }
  a { color: #92492f; }
  li { margin: 8px 0; }
  img { display: block; max-width: 100%; height: auto; margin: 20px auto 30px; border: 1px solid #d9d1c7; border-radius: 10px; box-shadow: 0 8px 24px #33271b14; }
  blockquote { margin: 20px 0; padding: 2px 18px; border-left: 4px solid #aa5c3d; background: #f1ebe2; }
  table { width: 100%; border-collapse: collapse; background: white; }
  td, th { border: 1px solid #d9d1c7; padding: 9px 12px; text-align: left; vertical-align: top; }
  th { background: #f1ebe2; }
  code { background: #eee7dc; padding: 1px 4px; border-radius: 3px; }
  @media (max-width: 600px) { body { padding: 14px 12px 50px; } table { font-size: .9em; } }
</style></head><body><main>${body}</main></body></html>`;

  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "USER-GUIDE.md"), source);
  fs.writeFileSync(path.join(destination, "USER-GUIDE.html"), html);
  for (const imagePath of new Set(imagePaths)) {
    const target = path.join(destination, imagePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, "docs", imagePath), target);
  }
  return { images: imagePaths.length, html: path.join(destination, "USER-GUIDE.html") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(renderUserGuide(path.resolve(root, "build/user-guide-preview")));
