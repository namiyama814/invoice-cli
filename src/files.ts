import { readFile, stat, lstat, access, mkdtemp, writeFile, rename, link, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
export async function loadStamp(path: string, base: string) {
  const fullPath = resolve(base, path);
  const extension = extname(fullPath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('印鑑はPNG/JPEG形式にしてください。');
  const info = await stat(fullPath);
  if (!info.isFile() || info.size > 1048576) throw new Error('印鑑画像は1MiB以下のファイルにしてください。');
  const data = await readFile(fullPath);
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (extension === '.png' ? !png : !jpeg) throw new Error('印鑑画像の内容と拡張子が一致しません。');
  return { data, name: basename(fullPath), type: png ? 'image/png' : 'image/jpeg' };
}
export async function checkOutput(path: string, force: boolean, protectedPaths: readonly string[] = []) {
  const fullPath = resolve(path);
  let entry;
  try { entry = await lstat(fullPath); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const source of protectedPaths) {
    const message = '保存先を入力JSONや印鑑画像と同じファイルにはできません。';
    if (fullPath === resolve(source)) throw new Error(message);
    if (entry) {
      // Follow symlinks and compare file identities to cover aliases and hardlinks.
      let target;
      try { target = await stat(fullPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const input = await stat(source);
      if (target && target.dev === input.dev && target.ino === input.ino) throw new Error(message);
    }
  }
  if (entry?.isDirectory()) throw new Error('保存先にディレクトリは指定できません。');
  if (entry && !force) throw new Error('保存先が存在します。上書きするには--forceを指定してください。');
  // Fail before sending invoice data when the destination cannot be created.
  const parent = dirname(fullPath);
  if (!(await stat(parent)).isDirectory()) throw new Error('保存先の親にディレクトリを指定してください。');
  await access(parent, constants.W_OK | constants.X_OK);
}
export async function saveAtomic(path: string, data: Uint8Array | string, force: boolean, protectedPaths: readonly string[] = []) {
  const fullPath = resolve(path);
  await checkOutput(fullPath, force, protectedPaths);
  const temp = await mkdtemp(join(dirname(fullPath), '.invoice-cli-'));
  try {
    const file = join(temp, 'output');
    await writeFile(file, data, { mode: 0o600 });
    if (force) await rename(file, fullPath);
    else await link(file, fullPath);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
