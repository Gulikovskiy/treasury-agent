import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { FIXTURE_DIR } from "../config.js";

export const fixturePath = (...parts: string[]): string => join(FIXTURE_DIR, ...parts);

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, bigintReplacer, 2)}\n`);
  console.log(`wrote ${path}`);
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return Boolean(entry && importMetaUrl === pathToFileURL(entry).href);
}
